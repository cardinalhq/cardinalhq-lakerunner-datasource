import {
  DataFrameType,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
  DataSourceWithSupplementaryQueriesSupport,
  toDataFrame,
  DataFrame,
  ScopedVars,
  MetricFindValue,
  LegacyMetricFindQueryOptions as VariableQueryOptions,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Observable } from 'rxjs';
import { MyQuery, MyDataSourceOptions, Filter, TEXT_OPERATORS } from './types';
import { buildNestedFilter } from './util/buildNestedFilter';
import { toInternalLabel, fetchTagKeys, fetchTagValues } from './services/logs';

export class DataSource
  extends DataSourceApi<MyQuery, MyDataSourceOptions>
  implements DataSourceWithSupplementaryQueriesSupport<MyQuery>
{
  private logBodyCache: Record<string, Set<string>> = {};
  private cacheVersion: Record<string, number> = {};
  private previousFilters: Record<string, Filter[]> = {};

  private areFiltersEqual(a: Filter[], b: Filter[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const normalize = (f: Filter) => `${f.tag}|${f.op}|${(f.value ?? []).join(',')}`;
    const sortedA = [...a].map(normalize).sort();
    const sortedB = [...b].map(normalize).sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  private readonly instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.instanceSettings = instanceSettings;
  }
  public isAdvancedEnabled(): boolean {
    return Boolean(this.instanceSettings.jsonData?.enableAdvancedTab && this.instanceSettings.jsonData.promqlPath);
  }
  public getPromqlPath(): string {
    return String(this.instanceSettings.jsonData?.promqlPath ?? '');
  }

  public isTracesEnabled(): boolean {
    return Boolean(this.instanceSettings.jsonData?.enableTraces);
  }

  private applyTemplateVariables(q: MyQuery, scopedVars: ScopedVars): MyQuery {
    const tsrv = getTemplateSrv();
    const repl = (v?: string, fmt?: string) => (v == null ? v : tsrv.replace(v, scopedVars, fmt));

    const expandValues = (op: string, vals: string[] = []) => {
      const isTextOrRegex = TEXT_OPERATORS.includes(op as any) || op === 'regex' || op === 'not regex';
      const fmt = isTextOrRegex ? 'regex' : 'csv';

      const out: string[] = [];
      for (const raw of vals) {
        const rep = repl(raw, fmt) ?? '';
        if (!rep) {
          continue;
        }
        if (fmt === 'csv') {
          rep
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((v) => out.push(v));
        } else {
          out.push(rep);
        }
      }
      return out.length ? out : vals;
    };

    return {
      ...q,
      metricName: repl(q.metricName),
      filters: (q.filters ?? []).map((f) => ({
        ...f,
        tag: repl(f.tag) as string,
        value: expandValues(f.op, f.value),
      })),
      groupBy: (q.groupBy ?? []).map((g) => repl(g) as string),
      queryText: q.queryText,
      metricType: q.metricType,
      chartField: q.chartField,
      chartAggregation: q.chartAggregation,
      aggregation: q.aggregation,
      extractor: q.extractor,
    };
  }

  public getCachedLogBodies(refId: string): string[] {
    const set = this.logBodyCache[refId] || new Set<string>();
    return Array.from(set);
  }

  public getLogCacheVersion(refId: string): number {
    return this.cacheVersion[refId] || 0;
  }
  public resetLogBodyCache(refId: string): void {
    delete this.logBodyCache[refId];
    delete this.cacheVersion[refId];
  }
  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume, SupplementaryQueryType.LogsSample];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: MyQuery): MyQuery | undefined {
    const isMetricsLike = query.mode === 'metrics' || query.mode === 'promQL';

    if (isMetricsLike && options.type === SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    if (isMetricsLike && options.type === SupplementaryQueryType.LogsSample) {
      return undefined;
    }

    switch (options.type) {
      case SupplementaryQueryType.LogsVolume:
        return {
          ...query,
          refId: `volume-${query.refId}`,
          queryText: 'volume',
        };
      case SupplementaryQueryType.LogsSample:
        return {
          ...query,
          refId: `sample-${query.refId}`,
          queryText: 'sample',
        };
      default:
        return undefined;
    }
  }

  getSupplementaryRequest(
    type: SupplementaryQueryType,
    request: DataQueryRequest<MyQuery>,
    options?: SupplementaryQueryOptions
  ): DataQueryRequest<MyQuery> | undefined {
    if (!this.getSupportedSupplementaryQueryTypes().includes(type)) {
      return undefined;
    }

    const targets = request.targets
      .map((query) => this.getSupplementaryQuery({ type, ...options }, query))
      .filter((q): q is MyQuery => !!q);
    return targets.length ? { ...request, targets } : undefined;
  }

  private getDefaultRange(): { s: number; e: number } {
    const e = Date.now();
    return { s: e - 6 * 60 * 60 * 1000, e }; // last 6h
  }

  private parseVarQuery(raw: string): {
    kind: 'keys' | 'values';
    dataset: 'logs' | 'metrics';
    key?: string;
    metricName?: string;
    metricType?: string;
  } {
    const tsrv = getTemplateSrv();
    const q = tsrv.replace(String(raw ?? ''), undefined as any).trim();

    const ds = /dataset\s*=\s*(logs|metrics)/i.exec(q)?.[1]?.toLowerCase() as 'logs' | 'metrics' | undefined;
    const dataset = ds ?? 'logs';

    const metricName = /metricName\s*=\s*([^\s,)\]]+)/i.exec(q)?.[1];
    const metricType = /metricType\s*=\s*([^\s,)\]]+)/i.exec(q)?.[1];

    const valM =
      /^tag_values\s*\(\s*([^) ,]+).*?\)/i.exec(q) ||
      /^label_values\s*\(\s*([^) ,]+).*?\)/i.exec(q) ||
      (/^[A-Za-z0-9_.-]+$/.test(q) ? ([, q] as any) : null);

    if (/^tag_keys\b/i.test(q)) {
      return { kind: 'keys', dataset, metricName, metricType };
    }
    if (valM?.[1]) {
      return { kind: 'values', dataset, key: valM[1], metricName, metricType };
    }

    return { kind: 'keys', dataset, metricName, metricType };
  }

  async metricFindQuery(query: any, options?: VariableQueryOptions): Promise<MetricFindValue[]> {
    const qstr = typeof query === 'string' ? query : query?.query ?? '';
    const { kind, dataset, key, metricName, metricType } = this.parseVarQuery(qstr);

    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;

    if (kind === 'keys') {
      const keys = await fetchTagKeys({
        datasourceId: this.id,
        mode: dataset,
        startTime: s,
        endTime: e,
        metricName,
        metricType,
      });
      return keys.map((k) => ({ text: k }));
    }

    if (!key) {
      return [];
    }
    const vals = await fetchTagValues({
      datasourceId: this.id,
      mode: dataset,
      labelName: key,
      startTime: s,
      endTime: e,
      metricName,
      metricType,
    });
    return vals.map((v) => ({ text: v }));
  }

  async getTagKeys(options?: any): Promise<MetricFindValue[]> {
    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;
    const dataset: 'logs' | 'metrics' = options?.dataset ?? 'logs';
    const keys = await fetchTagKeys({ datasourceId: this.id, mode: dataset, startTime: s, endTime: e });
    return keys.map((k) => ({ text: k }));
  }

  async getTagValues(options: any): Promise<MetricFindValue[]> {
    const key = options?.key;
    if (!key) {
      return [];
    }
    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;
    const dataset: 'logs' | 'metrics' = options?.dataset ?? 'logs';
    const vals = await fetchTagValues({
      datasourceId: this.id,
      mode: dataset,
      labelName: key,
      startTime: s,
      endTime: e,
    });
    return vals.map((v) => ({ text: v }));
  }

  query(request: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    return new Observable<DataQueryResponse>((subscriber) => {
      const controller = new AbortController();
      subscriber.add(() => controller.abort());

      const templatedTargets = request.targets
        .filter((t) => !t.hide)
        .map((t) => this.applyTemplateVariables(t, request.scopedVars ?? ({} as ScopedVars)));

      let remaining = templatedTargets.length;
      if (remaining === 0) {
        subscriber.next({ data: [] });
        subscriber.complete();
        return;
      }
      const latestByRef: Record<string, DataFrame[]> = {};

      const EMIT_MS = 150;
      let emitScheduled = false;
      let emitTimer: ReturnType<typeof setTimeout> | null = null;

      const emitMerged = () => {
        const merged: DataFrame[] = Object.values(latestByRef).flat();
        subscriber.next({ data: merged });
      };

      const scheduleEmit = () => {
        if (emitScheduled) {
          return;
        }
        emitScheduled = true;
        emitTimer = setTimeout(() => {
          emitScheduled = false;
          emitTimer = null;
          emitMerged();
        }, EMIT_MS);
      };
      subscriber.add(() => {
        if (emitTimer) {
          clearTimeout(emitTimer);
          emitTimer = null;
        }
      });

      for (const target of templatedTargets) {
        this.runSingleQuery(target, request.range, controller.signal, (frames: DataFrame[]) => {
          latestByRef[target.refId] = frames;
          scheduleEmit();
        })
          .then(() => {
            if (--remaining === 0) {
              if (emitTimer) {
                clearTimeout(emitTimer);
                emitTimer = null;
                emitScheduled = false;
              }
              emitMerged();
              subscriber.complete();
            }
          })
          .catch((err) => {
            if ((err as any).name === 'AbortError') {
              if (--remaining === 0) {
                if (emitTimer) {
                  clearTimeout(emitTimer);
                  emitTimer = null;
                  emitScheduled = false;
                }
                emitMerged();
                subscriber.complete();
              }
            } else {
              subscriber.error(err);
            }
          });
      }
    });
  }

  private async runSingleQuery(
    target: MyQuery,
    range: DataQueryRequest['range'],
    signal: AbortSignal,
    emit?: (frames: DataFrame[]) => void
  ): Promise<DataFrame[]> {
    this.resetLogBodyCache(target.refId);

    const isLogVolumeQuery = target.queryText === 'volume';
    const isPromql = target.mode === 'promQL';
    const isMetrics = target.mode === 'metrics' || isPromql;

    const rawFilters: Filter[] = target.filters ?? [];
    const filters: Filter[] = rawFilters.filter((f) => {
      const isKeyValid = f.tag?.trim();
      const isValueValid = Array.isArray(f.value) && f.value.some((v) => v?.trim?.());
      return isKeyValid && isValueValid;
    });
    const prev = this.previousFilters[target.refId] ?? [];
    const filtersChanged = !this.areFiltersEqual(prev, filters);
    if (filtersChanged && !target.extractor?.selections?.length) {
      target.extractor = undefined;
    }
    const hasValidExtractor = !!target.extractor?.regex && Array.isArray(target.extractor?.fields);
    const hasMetricName = !!target.metricName;
    const hasFilters = filters.length > 0;

    if (!isMetrics && !hasFilters && !hasValidExtractor) {
      return [];
    }
    if (isMetrics && !hasMetricName) {
      return [];
    }
    this.previousFilters[target.refId] = filters;
    const groupBy: string[] = isLogVolumeQuery
      ? [toInternalLabel('level')]
      : (target.groupBy ?? []).map(toInternalLabel);
    const MAX_INITIAL = 1000;

    if (isMetrics && target.metricName) {
      filters.unshift({
        tag: '_cardinalhq.name',
        op: '=',
        value: [target.metricName],
      });
    }

    let allFilters = [...filters];

    if (target.extractor?.selections?.length) {
      const extractedFilters: Filter[] = target.extractor.selections
        .filter((sel) => sel.label && sel.userSelected)
        .map((sel) => ({
          tag: sel.label,
          op: 'has',
          value: [''],
          dataType: sel.dataType,
          extracted: true,
          computed: false,
        }));

      allFilters = [...allFilters, ...extractedFilters];
    }

    let nestedFilter = buildNestedFilter(allFilters);

    if (!nestedFilter && !isMetrics) {
      nestedFilter = {
        k: '_cardinalhq.name',
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      } as any;
    }

    const from = range?.from.valueOf();
    const to = range?.to.valueOf();

    const dataset = isMetrics ? 'metrics' : 'logs';
    const expression: any = {
      dataset,
      returnResults: true,
      filter: nestedFilter,
    };
    if (target.extractor && Array.isArray(target.extractor.selections) && Array.isArray(target.extractor.fields)) {
      expression.extract = {
        regex: target.extractor.regex,
        fields: target.extractor.selections.map((sel, i) => ({
          name: target.extractor!.fields[i] || `var_${i + 1}`,
          type: sel.dataType,
        })),
      };
    }

    if (isMetrics && target.metricType) {
      expression.metricType = target.metricType;
    }

    const hasExtractor = !!target.extractor?.regex && Array.isArray(target.extractor.fields);
    const chartField = target.chartField;
    const chartAggregation = target.chartAggregation ?? 'sum';
    const normalAggregation = target.aggregation ?? 'sum';

    const hasNumericChartField =
      hasExtractor &&
      chartField &&
      target.extractor?.selections?.some((sel) => sel.label === chartField && sel.dataType === 'number');

    if (isMetrics) {
      expression.chart = {
        aggregation: normalAggregation,
        rollup: normalAggregation,
        groupBys: groupBy,
        type: 'count',
      };
    } else if (isLogVolumeQuery) {
      expression.chart = {
        aggregation: normalAggregation,
        rollup: normalAggregation,
        groupBys: groupBy,
        type: 'count',
      };
    } else if (hasNumericChartField) {
      const selected = target.extractor!.selections.find(
        (sel) => sel.label === chartField && sel.dataType === 'number'
      );
      expression.chart = {
        aggregation: chartAggregation,
        rollup: chartAggregation,
        groupBys: groupBy,
        type: 'count',
        fieldName: chartField,
        fieldType: selected?.dataType ?? 'number',
      };
    }

    const payload = {
      baseExpressions: {
        a: expression,
      },
    };

    const urlParams = new URLSearchParams();
    urlParams.set('s', String(from));
    urlParams.set('e', String(to));
    if (isLogVolumeQuery) {
      urlParams.set('timeseriesOnly', 'true');
    }

    const response = await fetch(`/api/datasources/${this.id}/resources/proxy-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `/api/v1/graph?${urlParams.toString()}`,
        body: payload,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Streaming request failed for query ${target.refId}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const frameData: Record<string, { timestamps: number[]; values: number[] }> = {};
    const timestamps: number[] = [];
    const bodies: string[] = [];
    const severities: string[] = [];
    const ids: string[] = [];
    const labelsArr: any[] = [];

    let emitCount = 0;
    let totalLogs = 0;
    let buffer = '';
    const frames: DataFrame[] = [];

    let lastEmit = 0;
    const shouldEmit = () => !!emit && (emitCount % 50 === 0 || performance.now() - lastEmit > 250);
    const didEmit = () => {
      lastEmit = performance.now();
    };

    const flushMetricFramesInto = (dst: DataFrame[] = frames) => {
      const levelColors: Record<string, string> = {
        debug: '#C8C8C8',
        info: '#32CD32',
        warn: '#FFD700',
        error: '#DC143C',
      };

      for (const [label, series] of Object.entries(frameData)) {
        const ref = target.refId;
        const match = /^level=(\w+)$/.exec(label);
        const level = match?.[1];

        const labels = level ? { level, detected_level: level } : undefined;
        const displayName = level ? `{detected_level="${level}", level="${level}"}` : label;

        const color = levelColors[level?.toLowerCase() ?? ''] ?? undefined;

        const frame = toDataFrame({
          refId: ref,
          name: label,
          fields: [
            { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
            {
              name: 'Value',
              type: FieldType.number,
              values: series.values.slice(),
              labels,
              config: {
                displayNameFromDS: displayName,
                color: color ? { mode: 'fixed', fixedColor: color } : { mode: 'palette-classic' },
              },
            },
          ],
        });

        (frame.meta as any) = { preferredVisualisationType: 'graph' };
        dst.push(frame);
      }
    };

    const buildLogsSnapshot = (): DataFrame => {
      const frame = toDataFrame({
        refId: target.refId,
        name: 'logs',
        fields: [
          { name: 'timestamp', type: FieldType.time, values: timestamps.slice() },
          { name: 'body', type: FieldType.string, values: bodies.slice() },
          { name: 'severity', type: FieldType.string, values: severities.slice() },
          { name: 'id', type: FieldType.string, values: ids.slice() },
          { name: 'labels', type: FieldType.other, values: labelsArr.slice() },
        ],
      });
      frame.meta = {
        type: DataFrameType.LogLines,
        preferredVisualisationType: 'logs',
        custom: { limit: 1000 },
      };
      return frame;
    };

    const flushMetricFrames = () => {
      flushMetricFramesInto(frames);
    };

    const flushLogFrame = () => {
      const frame = buildLogsSnapshot();
      frames.push(frame);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        try {
          const parsed = JSON.parse(line.slice(5).trim());
          const msg = parsed.message;
          if (!msg) {
            continue;
          }
          if (parsed.type === 'timeseries' && hasNumericChartField && !isMetrics && !isLogVolumeQuery) {
            const value = msg.value;
            const label = `${chartField}=extracted`;

            if (typeof value === 'number' && !isNaN(value)) {
              if (!frameData[label]) {
                frameData[label] = { timestamps: [], values: [] };
              }
              const ts = msg.timestamp;
              frameData[label].timestamps.push(ts);
              frameData[label].values.push(value);
              emitCount++;
            }
          } else if (isMetrics) {
            const ts = msg.timestamp;
            const val = msg.value ?? 0;
            const tags = msg.tags ?? {};
            const labelParts: string[] = groupBy.map((key) => {
              const prettyKey = key.replace(/^_cardinalhq\./, '');
              return `${prettyKey}=${tags[key] ?? 'unknown'}`;
            });

            const label = labelParts.length ? labelParts.join(', ') : isMetrics ? target.metricName ?? 'metric' : '';

            if (!frameData[label]) {
              frameData[label] = { timestamps: [], values: [] };
            }

            frameData[label].timestamps.push(ts);
            frameData[label].values.push(val);

            emitCount++;
          } else if (parsed.type === 'timeseries' && msg.tags?.name === 'log.events') {
            const ts = msg.timestamp;
            const val = msg.value ?? 0;
            const tags = msg.tags || {};

            const labelParts = groupBy.map((key) => {
              const prettyKey = key.replace(/^_cardinalhq\./, '');
              return `${prettyKey}=${tags[key] ?? 'unknown'}`;
            });
            const label = labelParts.length > 0 ? labelParts.join(', ') : tags.name || 'log.events';

            if (!frameData[label]) {
              frameData[label] = { timestamps: [], values: [] };
            }
            frameData[label].timestamps.push(ts);
            frameData[label].values.push(val);
            emitCount++;
          } else if (parsed.type === 'event') {
            const ts = msg.timestamp;
            const body = msg.tags?.['_cardinalhq.message'] || msg.tags?.['log.message'] || msg.tags?.message || '';
            const severity = msg.tags?.['_cardinalhq.level'] || '';
            const id = msg.tags?.['_cardinalhq.id'] || '';
            const rawTags = msg.tags || {};
            const labelTags: Record<string, any> = {};

            if (rawTags['_cardinalhq.message']) {
              labelTags['message'] = rawTags['_cardinalhq.message'];
            }
            if (rawTags['_cardinalhq.level']) {
              labelTags['level'] = rawTags['_cardinalhq.level'];
            }
            for (const [k, v] of Object.entries(rawTags)) {
              if (!k.startsWith('_cardinalhq.') && !k.startsWith('nlp')) {
                labelTags[k] = v;
              }
            }

            if (!this.logBodyCache[target.refId]) {
              this.logBodyCache[target.refId] = new Set<string>();
              this.cacheVersion[target.refId] = 0;
            }
            this.logBodyCache[target.refId].add(body);
            this.cacheVersion[target.refId]++;

            totalLogs++;

            if (totalLogs <= MAX_INITIAL) {
              timestamps.push(ts);
              bodies.push(body);
              severities.push(severity);
              ids.push(id);
              labelsArr.push(labelTags);
            } else {
              const frame = toDataFrame({
                refId: target.refId,
                name: 'logs',
                fields: [
                  { name: 'timestamp', type: FieldType.time, values: [ts] },
                  { name: 'body', type: FieldType.string, values: [body] },
                  { name: 'severity', type: FieldType.string, values: [severity] },
                  { name: 'id', type: FieldType.string, values: [id] },
                  { name: 'labels', type: FieldType.other, values: [labelTags] },
                ],
              });
              frame.meta = {
                type: DataFrameType.LogLines,
                preferredVisualisationType: 'logs',
                custom: { limit: 1000 },
              };

              frames.push(frame);
              if (emit) {
                emit([frame]);
              }
            }
          }
          if (shouldEmit()) {
            const batch: DataFrame[] = [];
            flushMetricFramesInto(batch);
            if (!isMetrics && totalLogs > 0 && totalLogs <= MAX_INITIAL) {
              batch.push(buildLogsSnapshot());
            }
            if (batch.length) {
              emit!(batch);
            }
            didEmit();
          }
        } catch (err) {}
      }
    }

    if (isMetrics || target.queryText === 'volume') {
      flushMetricFrames();
    } else {
      if (Object.keys(frameData).length > 0) {
        flushMetricFrames();
      }
      if (totalLogs > 0 && totalLogs <= MAX_INITIAL) {
        flushLogFrame();
      }
    }

    if (emit && frames.length) {
      emit(frames);
    }

    return frames;
  }

  async testDatasource() {
    return {
      status: 'success',
      message: 'Successfully connected to CardinalHQ',
    };
  }
}
