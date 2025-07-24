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
} from '@grafana/data';
import { Observable } from 'rxjs';
import { MyQuery, MyDataSourceOptions, Filter } from './types';
import { buildNestedFilter } from './util/buildNestedFilter';
import { toInternalLabel } from './services/logs';

export class DataSource
  extends DataSourceApi<MyQuery, MyDataSourceOptions>
  implements DataSourceWithSupplementaryQueriesSupport<MyQuery>
{
  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
  }
  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume, SupplementaryQueryType.LogsSample];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: MyQuery): MyQuery | undefined {
    if (query.mode === 'metrics' && options.type === SupplementaryQueryType.LogsSample) {
      return undefined;
    }
    switch (options.type) {
      case SupplementaryQueryType.LogsVolume:
        return { ...query, refId: `volume-${query.refId}`, queryText: 'volume' };
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

  query(request: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> {
    return new Observable<DataQueryResponse>((subscriber) => {
      const controller = new AbortController();
      subscriber.add(() => controller.abort());

      const run = async () => {
        const allFrames: any[] = [];

        await Promise.all(
          request.targets.map(async (target) => {
            try {
              const frames = await this.runSingleQuery(target, request.range, controller.signal);
              allFrames.push(...frames);
            } catch (err) {}
          })
        );

        subscriber.next({ data: allFrames });
        subscriber.complete();
      };

      run().catch((err) => {
        if ((err as any).name === 'AbortError') {
          subscriber.complete();
        } else {
          subscriber.error(err);
        }
      });
    });
  }

  private async runSingleQuery(
    target: MyQuery,
    range: DataQueryRequest['range'],
    signal: AbortSignal
  ): Promise<DataFrame[]> {
    const isMetrics = target.mode === 'metrics';
    const filters: Filter[] = [...(target.filters ?? [])];
    const groupBy: string[] = (target.groupBy ?? []).map(toInternalLabel);
    const MAX_INITIAL = 1000;

    if (isMetrics && target.metricName) {
      filters.unshift({
        tag: '_cardinalhq.name',
        op: '=',
        value: [target.metricName],
      });
    }

    let nestedFilter = buildNestedFilter(filters);
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
      chart: {
        aggregation: target.aggregation ?? (isMetrics ? 'max' : 'sum'),
        rollup: target.aggregation ?? (isMetrics ? 'max' : 'sum'),
        groupBys: groupBy,
        type: isMetrics ? 'count' : 'rate',
      },
    };

    if (isMetrics && target.metricType) {
      expression.metricType = target.metricType;
    }

    const payload = {
      baseExpressions: {
        a: expression,
      },
    };

    const response = await fetch(`/api/datasources/${this.id}/resources/proxy-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `/api/v1/graph?s=${from}&e=${to}`,
        body: payload,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Streaming request failed for query ${target.refId}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const palette = [
      '#7EB26D',
      '#EAB839',
      '#6ED0E0',
      '#EF843C',
      '#E24D42',
      '#1F78C1',
      '#BA43A9',
      '#705DA0',
      '#508642',
      '#CCA300',
      '#447EBC',
      '#C15C17',
    ];

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

    const flushMetricFrames = () => {
      for (const [label, series] of Object.entries(frameData)) {
        let hash = 0;
        const str = target.refId + '::' + label;
        for (let i = 0; i < str.length; i++) {
          hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colorIdx = Math.abs(hash) % palette.length;
        const frame = toDataFrame({
          refId: target.refId,
          name: label,
          fields: [
            { name: 'Time', type: FieldType.time, values: series.timestamps },
            {
              name: 'Value',
              type: FieldType.number,
              values: series.values,
              config: {
                displayName: label,
                color: {
                  mode: 'fixed',
                  fixedColor: palette[colorIdx],
                },
              },
            },
          ],
        });

        frame.meta = { preferredVisualisationType: 'graph' };
        frames.push(frame);
      }
    };

    const flushLogFrame = () => {
      const frame = toDataFrame({
        refId: target.refId,
        name: 'logs',
        fields: [
          { name: 'timestamp', type: FieldType.time, values: timestamps },
          { name: 'body', type: FieldType.string, values: bodies },
          { name: 'severity', type: FieldType.string, values: severities },
          { name: 'id', type: FieldType.string, values: ids },
          { name: 'labels', type: FieldType.other, values: labelsArr },
        ],
      });
      frame.meta = {
        type: DataFrameType.LogLines,
        preferredVisualisationType: 'logs',
        custom: { limit: 1000 },
      };
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

          const isVolume = target.queryText === 'volume' || target.refId.startsWith('volume-');

          if (isMetrics || isVolume) {
            const ts = msg.timestamp;
            const val = msg.value ?? 0;
            const tags = msg.tags ?? {};

            const labelParts: string[] = groupBy.map((key) => {
              const prettyKey = key.replace(/^_cardinalhq\./, '');
              return `${prettyKey}=${tags[key] ?? 'unknown'}`;
            });

            const label = labelParts.length
              ? labelParts.join(', ')
              : isMetrics
              ? target.metricName ?? 'metric'
              : 'log.events';

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
            const labelTags = msg.tags || {};

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
            }
          }
        } catch (err) {}
      }
    }

    if (isMetrics || target.queryText === 'volume') {
      flushMetricFrames();
    } else if (totalLogs > 0 && totalLogs <= MAX_INITIAL) {
      flushLogFrame();
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
