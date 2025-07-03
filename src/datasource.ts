import {
  DataFrameType,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  FieldType,
  toDataFrame,
} from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { MyQuery, MyDataSourceOptions } from './types';

export class DataSource extends DataSourceApi<MyQuery, MyDataSourceOptions> {
  private apiKey: string;
  private apiUrl: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.apiKey = '';
    this.apiUrl = 'https://app.cardinalhq.io';
  }

  async query(request: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const target = request.targets[0];
    const { tag, op, value } = target;
  
    if (!value || !value.length || !value[0]?.trim()) {
      return { data: [] };
    }
  
    const from = request.range!.from.valueOf();
    const to = request.range!.to.valueOf();
    const url = `${this.apiUrl}/api/v1/graph?s=${from}&e=${to}`;
  
    const payload = {
      baseExpressions: {
        a: {
          dataset: 'logs',
          limit: 1000,
          order: 'DESC',
          returnResults: true,
          filter: {
            k: tag,
            v: value,
            op: op === '=' ? 'eq' : op,
            dataType: 'string',
            extracted: false,
            computed: false,
          },
          chart: {
            aggregation: 'sum',
            rollup: 'sum',
            groupBys: [],
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
      const bodies: string[] = [];
      const severities: string[] = [];
      const ids: string[] = [];
      const labels: any[] = [];
  
      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned.startsWith('data:')) continue;
  
        try {
          const jsonStr = cleaned.slice(5).trim();
          const parsed = JSON.parse(jsonStr);
      
          if (parsed.type === 'event' && parsed.message) {
            const msg = parsed.message;
            timestamps.push(msg.timestamp);
            bodies.push(msg.tags?.['_cardinalhq.message'] || msg.tags?.['log.message'] || msg.tags?.message || '');
            severities.push(msg.tags?.['_cardinalhq.level'] || 'info');
            ids.push(msg.tags?.['_cardinalhq.id'] || '');
            labels.push(msg.tags || {});
          }
        } catch (e) {
          console.warn('Invalid log line:', line);
        }      
      }
  
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
        custom: {
          limit: 1000,
        },
      };
  
      console.log('Returning logs frame with', bodies.length, 'entries');
      return { data: [frame] };
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
