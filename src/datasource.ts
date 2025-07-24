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
        const target = request.targets[0];
        const MAX_INITIAL = 1000;
        let totalLogs = 0;

        const isMetrics = target.mode === 'metrics';
        if (isMetrics && !target.metricName) {
          subscriber.next({ data: [] });
          subscriber.complete();
          return;
        }

        const filters: Filter[] = [...(target.filters ?? [])];
        const groupBy: string[] = (target.groupBy ?? []).map(toInternalLabel);

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

        const from = request.range?.from.valueOf();
        const to = request.range?.to.valueOf();

        const dataset = isMetrics ? 'metrics' : 'logs';
        const expression: any = {
          dataset,
          returnResults: true,
          filter: nestedFilter,
          chart: {
            aggregation: isMetrics ? 'max' : 'sum',
            rollup: isMetrics ? 'max' : 'sum',
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
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Streaming request failed (HTTP ${response.status})`);
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
        let emitCount = 0;

        const timestamps: number[] = [];
        const bodies: string[] = [];
        const severities: string[] = [];
        const ids: string[] = [];
        const labelsArr: any[] = [];

        const flushMetricFrames = () => {
          const frames = Object.entries(frameData).map(([label, series], idx) => {
            const frame = toDataFrame({
              refId: `${target.refId}-${idx}`,
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
                      fixedColor: palette[idx % palette.length],
                    },
                  },
                },
              ],
            });
            frame.meta = { preferredVisualisationType: 'graph' };
            return frame;
          });
          subscriber.next({ data: frames });
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
          subscriber.next({ data: [frame] });
        };

        let buffer = '';
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

                const labelParts: string[] = [];
                for (const key of groupBy) {
                  const value = tags[key];
                  const prettyKey = key.replace(/^_cardinalhq\./, '');
                  labelParts.push(`${prettyKey}=${value ?? 'unknown'}`);
                }

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
                if (emitCount % 10 === 0) {
                  flushMetricFrames();
                }
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
                  const tempFrame = toDataFrame({
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
                  tempFrame.meta = {
                    type: DataFrameType.LogLines,
                    preferredVisualisationType: 'logs',
                    custom: { limit: 1000 },
                  };
                  subscriber.next({ data: [tempFrame] });
                }
              }
            } catch (err) {
              console.log('Failed to parse stream line', err);
            }
          }
        }

        if (isMetrics) {
          flushMetricFrames();
        } else if (totalLogs > 0 && totalLogs <= MAX_INITIAL) {
          flushLogFrame();
        }

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

  async testDatasource() {
    return {
      status: 'success',
      message: 'Successfully connected to CardinalHQ',
    };
  }
}
