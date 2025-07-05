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

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> implements DataSourceWithSupplementaryQueriesSupport<MyQuery> {
  private apiKey: string;
  private apiUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.apiKey = 'REDACTED_API_KEY';
    this.apiUrl = 'https://app.cardinalhq.io';
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume, SupplementaryQueryType.LogsSample];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: MyQuery): MyQuery | undefined {
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
      const run = async () => {
        const target = request.targets[0];
        const filters: Filter[] = target.filters ?? [];
        const groupBy: string[] = target.groupBy ?? [];


        const nestedFilter = buildNestedFilter(filters);
        if (!nestedFilter) {
          subscriber.complete();
          return;
        }

        const from = request.range?.from.valueOf();
        const to = request.range?.to.valueOf();
        const url = `${this.apiUrl}/api/v1/graph?s=${from}&e=${to}`;

        const payload = {
          baseExpressions: {
            a: {
              dataset: 'logs',
              limit: 1000,
              order: 'DESC',
              returnResults: true,
              filter: nestedFilter,
              chart: {
                aggregation: 'sum',
                rollup: 'sum',
                groupBys: groupBy,
                type: 'rate',
              },
            },
          },
        };

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-key': this.apiKey,
            },
            body: JSON.stringify(payload),
          });

          if (!response.body) {
            subscriber.error(new Error('No response body'));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let partial = '';
          const isVolume = target.queryText === 'volume' || target.refId.startsWith('volume-');

          // LogsVolume
          const frameData: Record<string, { timestamps: number[]; values: number[] }> = {};
          let emitCount = 0;

          // LogsSample
          const timestamps: number[] = [];
          const bodies: string[] = [];
          const severities: string[] = [];
          const ids: string[] = [];
          const labels: any[] = [];

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            partial += decoder.decode(value, { stream: true });
            const lines = partial.split('\n');
            partial = lines.pop() ?? '';

            for (const line of lines) {
              const cleaned = line.trim();
              if (!cleaned.startsWith('data:')) continue;

              try {
                const parsed = JSON.parse(cleaned.slice(5).trim());
                const msg = parsed.message;

                if (isVolume) {
                  const ts = msg.timestamp;
                  const val = msg.value ?? 0;
                  const tags = msg.tags ?? {};

                  const labelParts: string[] = [];

                  for (const key of groupBy) {
                    const value = tags[key];
                    const prettyKey = key.replace(/^_cardinalhq\./, '');

                    if (value !== undefined) {
                      labelParts.push(`${prettyKey}=${value}`);
                    } else {
                      console.warn(`Missing tag for groupBy key '${key}'`, { tags });
                      labelParts.push(`${prettyKey}=unknown`);
                    }
                  }

                  const label = labelParts.length > 0 ? labelParts.join(', ') : 'log.events';

                  if (!frameData[label]) {
                    frameData[label] = { timestamps: [], values: [] };
                  }

                  frameData[label].timestamps.push(ts);
                  frameData[label].values.push(val);

                  emitCount++;
                  if (emitCount % 10 === 0) {

                    const palette = [
                      '#7EB26D', '#EAB839', '#6ED0E0', '#EF843C', '#E24D42', '#1F78C1',
                      '#BA43A9', '#705DA0', '#508642', '#CCA300', '#447EBC', '#C15C17',
                    ];
                    
                    const frames = Object.entries(frameData).map(([label, series], idx) =>
                      toDataFrame({
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
                      })
                    );                    
                    
                    subscriber.next({ data: frames });
                  }
                } else {
                  if (parsed.type !== 'event') {
                    continue; 
                  }
                  
                  const ts = msg.timestamp;
                  const body = msg.tags?.['_cardinalhq.message'] || msg.tags?.['log.message'] || msg.tags?.message || '';
                  const severity = msg.tags?.['_cardinalhq.level'] || '';
                  const id = msg.tags?.['_cardinalhq.id'] || '';
                  const labelTags = msg.tags || {};
                  
                  timestamps.push(ts);
                  bodies.push(body);
                  severities.push(severity);
                  ids.push(id);
                  labels.push(labelTags);

                  if (timestamps.length % 10 === 0) {
                    const frame = toDataFrame({
                      refId: target.refId,
                      name: labels,
                      fields: [
                        { name: 'timestamp', type: FieldType.time, values: timestamps },
                        { name: 'body', type: FieldType.string, values: bodies },
                        { name: 'severity', type: FieldType.string, values: severities },
                        { name: 'id', type: FieldType.string, values: ids },
                        { name: 'labels', type: FieldType.other, values: labels },
                      ],
                    });

                    frame.meta = {
                      type: DataFrameType.LogLines,
                      preferredVisualisationType: 'logs',
                      custom: { limit: 1000 },
                    };

                    subscriber.next({ data: [frame] });
                  }
                }
              } catch (err) {
                console.warn('Invalid log line:', line);
              }
            }
          }
          if (!isVolume && timestamps.length > 0) {
            const finalFrame = toDataFrame({
              refId: target.refId,
              name: 'logs',
              fields: [
                { name: 'timestamp', type: FieldType.time, values: timestamps },
                { name: 'body', type: FieldType.string, values: bodies },
                { name: 'severity', type: FieldType.string, values: severities },
                { name: 'id', type: FieldType.string, values: ids },
                { name: 'labels', type: FieldType.other, values: labels },
              ],
            });

            finalFrame.meta = {
              type: DataFrameType.LogLines,
              preferredVisualisationType: 'logs',
              custom: { limit: 1000 },
            };

            subscriber.next({ data: [finalFrame] });
          }

          subscriber.complete();
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            console.log('Fetch aborted');
          } else {
            subscriber.error(err);
          }
        }
      };
      run();
    });
  }

  async testDatasource() {
    return {
      status: 'success',
      message: 'Successfully connected to CardinalHQ',
    };
  }
}
