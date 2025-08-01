import { DataQuery } from '@grafana/schema';
import { DataSourceJsonData } from '@grafana/data';

export type Operator = '=' | '!=' | 'in' | 'not_in' | 'contains' | 'not contains' | 'regex' | 'not regex' | 'has';

export const OPERATOR_OPTIONS: Array<{ label: string; value: Operator }> = [
  { label: '=', value: '=' },
  { label: '!=', value: '!=' },
  { label: 'in', value: 'in' },
  { label: 'not in', value: 'not_in' },
  { label: 'contains', value: 'contains' },
  { label: 'not contains', value: 'not contains' },
  { label: 'regex', value: 'regex' },
  { label: 'not regex', value: 'not regex' },
];

export const AGGREGATE_OPTIONS = [
  { label: 'Avg', value: 'avg' },
  { label: 'Sum', value: 'sum' },
  { label: 'Min', value: 'min' },
  { label: 'Max', value: 'max' },
];
export type Aggregation = 'avg' | 'sum' | 'min' | 'max';
export type ChartAggregation = 'avg' | 'sum' | 'min' | 'max';
export const TEXT_OPERATORS: Operator[] = ['contains', 'not contains', 'regex', 'not regex'];
export const MULTIVALUE_OPERATORS: Operator[] = ['in', 'not_in'];

export interface Filter {
  tag: string;
  op: Operator;
  value: string[];
  dataType?: 'string' | 'number';
  extracted?: boolean;
  computed?: boolean;
}

export interface MyQuery extends DataQuery {
  filters?: Filter[];
  groupBy?: string[];
  queryText?: string;
  constant?: number;
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: 'gauge' | 'rate' | 'histogram';
  timeFrom?: number;
  timeTo?: number;
  chartAggregation?: ChartAggregation;
  aggregation?: Aggregation;
  selectedExemplar?: string | null;
  chartField?: string;
  extractor?: {
    regex: string;
    fields: string[];
    selections: Array<{
      index: number;
      recognizerName: string;
      dataType: 'string' | 'number';
      label: string;
      userSelected: boolean;
    }>;
  };
}

export const DEFAULT_QUERY: Partial<MyQuery> = {
  filters: [],
};

export interface DataPoint {
  Time: number;
  Value: number;
}

export interface DataSourceResponse {
  datapoints: Array<[number, number]>;
}

export interface MyDataSourceOptions extends DataSourceJsonData {
  customPath?: string;
}

export interface MySecureJsonData {
  apiKey?: string;
}

export interface ExploreQuery {
  id: string;
  dataset: 'logs' | 'metrics' | 'spans';
  params: {
    filters: ExploreQueryFilter[];
    chart?: {
      groupBys?: string[];
    };
    extractor?: MyQuery['extractor'];
  };
}

export interface ExploreQueryFilter {
  label: string;
  op: string;
  val?: string[];
  dataType?: string;
  extracted?: boolean;
  computed?: boolean;
}
