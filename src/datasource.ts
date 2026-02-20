/*
 * Copyright (C) 2025-2026 CardinalHQ, Inc
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import {
  CoreApp,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  DataSourceWithSupplementaryQueriesSupport,
  LoadingState,
  MetricFindValue,
  QueryFixAction,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
  LegacyMetricFindQueryOptions as VariableQueryOptions,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { Observable } from 'rxjs';
import { runPromQLQuery } from 'services/promql';
import { Filter, MyDataSourceOptions, MyQuery, TEXT_OPERATORS } from './types';
import { runLogQLQuery } from 'services/logql';
import { runTracesQuery } from 'services/traces';
import { fetchTags as fetchTagKeys, fetchTagValues } from './services/tags';
import { DataSourceFeatures, fetchDataSourceFeatures } from './services/features';

export class DataSource
  extends DataSourceApi<MyQuery, MyDataSourceOptions>
  implements DataSourceWithSupplementaryQueriesSupport<MyQuery>
{
  getDefaultQuery(_: CoreApp): Partial<MyQuery> {
    return {
      refId: 'A',
      mode: 'logs',
      filters: [],
      groupBy: [],
      aggregation: undefined,
      logqlAggregation: undefined,
      valueAs: undefined,
      queryText: undefined,
      metricName: undefined,
      metricType: undefined,
      chartField: undefined,
      chartAggregation: undefined,
      promqlModel: undefined,
      promqlDescription: undefined,
      promqlOutput: undefined,
      promqlEdited: undefined,
      promqlSubTab: undefined,
      logqlOutput: undefined,
      logqlBuilderExp: undefined,
      logqlEdited: undefined,
      logqlSubTab: undefined,
      direction: 'backward',
      tracesSubTab: undefined,
      tracesOutput: undefined,
      tracesEdited: undefined,
      tracesBuilderExp: undefined,
      tracesActive: undefined,
      timeFrom: undefined,
      timeTo: undefined,
      selectedExemplar: undefined,
      selectedFingerprint: undefined,
      fields: undefined,
      builderFields: undefined,
      codeFields: undefined,
      extractor: undefined,
    };
  }

  modifyQuery(query: MyQuery, action: QueryFixAction): MyQuery {
    const key = action.options?.key;
    const rawVal = action.options?.value;
    if (!key || rawVal == null) {
      return query;
    }
    const val = String(rawVal);
    const next = { ...query, filters: [...(query.filters ?? [])] };
    const findFilter = (ops: string[]) => next.filters.find((f) => f.tag === key && ops.includes(String(f.op)));
    const pushUnique = (arr: string[], v: string) => {
      if (!arr.includes(v)) {
        arr.push(v);
      }
    };
    switch (action.type) {
      case 'ADD_FILTER': {
        let f = findFilter(['in', '=']);
        if (!f) {
          f = { tag: key, op: '=', value: [val] };
          next.filters.push(f);
        } else {
          if (f.op === '=') {
            if (!f.value?.includes(val)) {
              f.op = 'in';
              f.value = [f.value?.[0] as string, val].filter(Boolean);
            }
          } else {
            f.value = Array.isArray(f.value) ? [...f.value] : [];
            pushUnique(f.value, val);
          }
        }
        break;
      }
      case 'ADD_FILTER_OUT': {
        let f = findFilter(['not_in', '!=']);
        if (!f) {
          f = { tag: key, op: 'not_in', value: [val] };
          next.filters.push(f);
        } else {
          if (f.op === '!=') {
            if (!f.value?.includes(val)) {
              f.op = 'not_in';
              f.value = [f.value?.[0] as string, val].filter(Boolean);
            }
          } else {
            f.value = Array.isArray(f.value) ? [...f.value] : [];
            pushUnique(f.value, val);
          }
        }
        break;
      }
      default:
        return query;
    }
    return next;
  }

  private fingerprintStore: Record<string, Map<string, string>> = {};
  private prevTopFilter: Record<string, string | undefined> = {};
  private ingestLogsFromFrames(refId: string, frames: DataFrame[]) {
    const key = this.normalizeRefId(refId);
    if (!this.fingerprintStore[key]) {
      this.fingerprintStore[key] = new Map();
    }
    for (const frame of frames) {
      if (!frame.fields) {
        continue;
      }
      const fieldsByName: Record<string, any> = {};
      frame.fields.forEach((field) => (fieldsByName[field.name] = field.values));
      const bodyField = fieldsByName['body'] ?? fieldsByName['line'];
      const fpField = fieldsByName['fingerprint'] ?? fieldsByName['_cardinalhq_fingerprint'] ?? fieldsByName['id'];
      if (!bodyField || !fpField) {
        continue;
      }
      const len = Math.min(bodyField.length, fpField.length);
      for (let i = 0; i < len; i++) {
        const body = String(bodyField.get ? bodyField.get(i) : bodyField[i] ?? '');
        const fp = String(fpField.get ? fpField.get(i) : fpField[i] ?? '');
        if (fp && body) {
          this.addLog(refId, fp, body);
        }
      }
    }
  }
  private clearLogs(refId: string) {
    const key = this.normalizeRefId(refId);
    this.fingerprintStore[key] = new Map();
  }

  private normalizeRefId(refId: string): string {
    const key = refId.replace(/^(volume-|sample-)/, '');
    return key;
  }

  public addLog(refId: string, fingerprint: string, body: string) {
    const key = this.normalizeRefId(refId);
    if (!this.fingerprintStore[key]) {
      this.fingerprintStore[key] = new Map();
    }
    this.fingerprintStore[key].set(fingerprint, body);
  }

  public getFingerprints(refId: string): string[] {
    const key = this.normalizeRefId(refId);
    const fps = Array.from(this.fingerprintStore[key]?.keys() ?? []);
    return fps;
  }
  private generateFilterKey(filters: Filter[]): string {
    return filters
      .filter((f) => f.tag?.trim() && f.value?.some((v) => v?.trim()))
      .map((f) => `${f.tag}:${f.op}:${(f.value || []).join(',')}`)
      .sort()
      .join('|');
  }
  public getBodies(refId: string): string[] {
    const key = this.normalizeRefId(refId);
    const bodies = Array.from(this.fingerprintStore[key]?.values() ?? []);
    return bodies;
  }

  private readonly instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>;
  private featuresPromise: Promise<DataSourceFeatures> | null = null;
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.instanceSettings = instanceSettings;
  }

  private async getFeatures(): Promise<DataSourceFeatures> {
    if (!this.featuresPromise) {
      this.featuresPromise = fetchDataSourceFeatures(this.id).catch(() => ({ metricsSummarySSE: false }));
    }
    return this.featuresPromise;
  }

  public async supportsMetricsSummarySSE(): Promise<boolean> {
    const features = await this.getFeatures();
    return features.metricsSummarySSE;
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
      aggregation: q.aggregation,
      logqlAggregation: q.logqlAggregation,
      queryText: q.queryText,
      metricType: q.metricType,
      chartField: q.chartField,
      chartAggregation: q.chartAggregation,
      extractor: q.extractor,
      logqlOutput: repl(q.logqlOutput),
      logqlBuilderExp: repl(q.logqlBuilderExp),
      promqlOutput: repl(q.promqlOutput),
      tracesOutput: repl(q.tracesOutput),
      tracesBuilderExp: repl(q.tracesBuilderExp),
    };
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume, SupplementaryQueryType.LogsSample];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: MyQuery): MyQuery | undefined {
    const isMetricsLike = query.mode === 'metrics';
    const isTracesLike = query.mode === 'traces';
    if (isMetricsLike && options.type === SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    if ((isMetricsLike || isTracesLike) && options.type === SupplementaryQueryType.LogsSample) {
      return undefined;
    }
    switch (options.type) {
      case SupplementaryQueryType.LogsVolume:
        return { ...query, refId: query.refId, queryText: 'volume' };
      case SupplementaryQueryType.LogsSample:
        return { ...query, refId: `sample-${query.refId}`, queryText: 'sample' };
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
    return { s: e - 6 * 60 * 60 * 1000, e };
  }

  private parseVarQuery(raw: string): {
    kind: 'keys' | 'values';
    dataset: 'logs' | 'metrics' | 'traces';
    tagName?: string;
    expr?: string;
    metricName?: string;
    metricType?: string;
  } {
    const tsrv = getTemplateSrv();
    const q = tsrv.replace(String(raw ?? ''), undefined as any).trim();
    const ds = /dataset\s*=\s*(logs|metrics|traces)/i.exec(q)?.[1]?.toLowerCase() as
      | 'logs'
      | 'metrics'
      | 'traces'
      | undefined;
    const dataset = ds ?? 'logs';
    const metricName = /metricName\s*=\s*([^\s,)\]]+)/i.exec(q)?.[1];
    const metricType = /metricType\s*=\s*([^\s,)\]]]+)/i.exec(q)?.[1];
    const exprKV = /expr\s*=\s*([^\s,)\]]]+)/i.exec(q)?.[1];
    const isKeys = /^tag_keys\b/i.test(q);
    const labelOnly = /^label_values\s*\(\s*([^) ,]+).*?\)/i.exec(q) || /^tag_values\s*\(\s*([^) ,]+).*?\)/i.exec(q);
    const exprThenLabel =
      /^label_values\s*\(\s*([^,]+?)\s*,\s*([^) ,]+)\s*\)/i.exec(q) ||
      /^tag_values\s*\(\s*([^,]+?)\s*,\s*([^) ,]+)\s*\)/i.exec(q);
    if (isKeys) {
      return { kind: 'keys', dataset, metricName, metricType, expr: exprKV };
    }
    if (exprThenLabel?.[1] && exprThenLabel?.[2]) {
      const parsedExpr = exprThenLabel[1].trim();
      const tagName = exprThenLabel[2].trim();
      return { kind: 'values', dataset, tagName, expr: parsedExpr, metricName, metricType };
    }
    if (labelOnly?.[1]) {
      const tagName = labelOnly[1].trim();
      return { kind: 'values', dataset, tagName, expr: exprKV, metricName, metricType };
    }
    if (/^[A-Za-z0-9_.-]+$/.test(q)) {
      return { kind: 'values', dataset, tagName: q, expr: exprKV, metricName, metricType };
    }
    return { kind: 'keys', dataset, metricName, metricType, expr: exprKV };
  }

  async metricFindQuery(query: any, options?: VariableQueryOptions): Promise<MetricFindValue[]> {
    const qstr = typeof query === 'string' ? query : query?.query ?? '';
    const { kind, dataset, tagName, expr, metricName } = this.parseVarQuery(qstr);
    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;
    if (kind === 'keys') {
      const keys = await fetchTagKeys({
        datasourceId: this.id,
        mode: dataset,
        startTime: s,
        endTime: e,
        metricName,
      });
      return keys.map((k: any) => ({ text: k }));
    }
    if (!tagName) {
      return [];
    }
    const vals = await fetchTagValues({
      datasourceId: this.id,
      mode: dataset,
      tagName,
      startTime: s,
      endTime: e,
      expr,
    });
    return vals.map((v: any) => ({ text: v }));
  }

  async getTagKeys(options?: any): Promise<MetricFindValue[]> {
    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;
    const dataset: 'logs' | 'metrics' | 'traces' = options?.dataset ?? 'logs';
    const metricName: string | undefined = options?.metricName;
    const keys = await fetchTagKeys({
      datasourceId: this.id,
      mode: dataset,
      startTime: s,
      endTime: e,
      metricName,
    });
    return keys.map((k: any) => ({ text: k }));
  }

  async getTagValues(options: any): Promise<MetricFindValue[]> {
    const tagName = options?.key;
    if (!tagName) {
      return [];
    }
    const s = options?.range?.from?.valueOf?.() ?? this.getDefaultRange().s;
    const e = options?.range?.to?.valueOf?.() ?? this.getDefaultRange().e;
    const dataset: 'logs' | 'metrics' | 'traces' = options?.dataset ?? 'logs';
    const expr: string | undefined = options?.expr;
    const vals = await fetchTagValues({
      datasourceId: this.id,
      mode: dataset,
      tagName,
      startTime: s,
      endTime: e,
      expr,
    });
    return vals.map((v: any) => ({ text: v }));
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
      let firstEmitDone = false;
      const emitMerged = (final = false) => {
        const merged: DataFrame[] = Object.values(latestByRef).flat();
        subscriber.next({
          data: merged,
          state: final ? LoadingState.Done : LoadingState.Streaming,
        });
      };
      const scheduleEmit = () => {
        if (!firstEmitDone) {
          firstEmitDone = true;
          emitMerged();
          return;
        }
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
              emitMerged(true);
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
    const mode = target.mode ?? 'logs';
    if (mode === 'metrics') {
      const supportsMetricsSummarySSE = await this.supportsMetricsSummarySSE();
      return runPromQLQuery(this.id, target, range, signal, emit, supportsMetricsSummarySSE);
    }
    if (mode === 'traces') {
      const key = this.normalizeRefId(target.refId);
      const topFilter = target.filters?.[0]
        ? `${target.filters[0].tag}:${target.filters[0].value?.join(',')}`
        : undefined;
      if (this.prevTopFilter[key] !== topFilter) {
        this.clearLogs(key);
      }
      this.prevTopFilter[key] = topFilter;
      return runTracesQuery(
        this.id,
        { uid: this.instanceSettings.uid!, name: this.instanceSettings.name! },
        target,
        range,
        signal,
        emit
      );
    }
    if (mode === 'logs') {
      const key = this.normalizeRefId(target.refId);
      const currentFilterKey = this.generateFilterKey(target.filters ?? []);
      if (this.prevTopFilter[key] !== currentFilterKey) {
        this.clearLogs(key);
        this.prevTopFilter[key] = currentFilterKey;
      }
      const frames = await runLogQLQuery(this.id, target, range, signal, emit);
      this.ingestLogsFromFrames(target.refId, frames);
      return frames;
    }
    return [];
  }

  async testDatasource() {
    return {
      status: 'success',
      message: 'Successfully connected to CardinalHQ',
    };
  }
}
