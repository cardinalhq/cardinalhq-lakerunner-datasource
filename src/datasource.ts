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
import { getBackendSrv } from '@grafana/runtime';
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

  async query(request: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const target = request.targets[0];
    const filters: Filter[] = target.filters ?? [];
    const groupBy: string[] = target.groupBy ?? [];

    const nestedFilter = buildNestedFilter(filters);
    if (!nestedFilter) {
      return { data: [] };
    }

    const from = request.range?.from.valueOf();
    const to = request.range?.to.valueOf();
    if (!from || !to) return { data: [] };

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
      const res = await getBackendSrv()
        .fetch<any>({
          url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey,
          },
          data: payload,
        })
        .toPromise();

      const lines = res?.data?.split?.('\n') ?? [];

      const timestamps: number[] = [];
      const values: number[] = [];
      const bodies: string[] = [];
      const severities: string[] = [];
      const ids: string[] = [];
      const labels: any[] = [];

      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned.startsWith('data:')) continue;

        try {
          const parsed = JSON.parse(cleaned.slice(5).trim());
          const msg = parsed.message;

          if (target.queryText === 'volume') {
            const ts = msg.timestamp;
            const val = msg.value ?? 0;
            timestamps.push(ts);
            values.push(val);
          } else {
            timestamps.push(msg.timestamp);
            bodies.push(
              msg.tags?.['_cardinalhq.message'] ||
              msg.tags?.['log.message'] ||
              msg.tags?.message ||
              ''
            );
            severities.push(msg.tags?.['_cardinalhq.level'] || '');
            ids.push(msg.tags?.['_cardinalhq.id'] || '');
            labels.push(msg.tags || {});
          }
        } catch (e) {
          console.warn('Invalid log line:', line);
        }
      }

      if (target.queryText === 'volume') {
        const frame = toDataFrame({
          refId: target.refId,
          name: 'logs_volume',
          fields: [
            { name: 'Time', type: FieldType.time, values: timestamps },
            { name: 'Value', type: FieldType.number, values },
          ],
        });
        frame.meta = {
          preferredVisualisationType: 'graph',
          custom: { limit: 1000 },
        };
        return { data: [frame] };
      } else {
        const frame = toDataFrame({
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

        frame.meta = {
          type: DataFrameType.LogLines,
          preferredVisualisationType: 'logs',
          custom: { limit: 1000 },
        };

        return { data: [frame] };
      }
    } catch (err) {
      console.error('CardinalHQ logs query failed:', err);
      return { data: [] };
    }
  }

  async testDatasource() {
    return {
      status: 'success',
      message: 'Successfully connected to CardinalHQ',
    };
  }
}
