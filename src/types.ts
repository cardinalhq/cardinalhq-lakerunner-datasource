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

import { DataQuery } from '@grafana/schema';
import { DataSourceJsonData } from '@grafana/data';

export type Operator =
  | '='
  | '!='
  | 'in'
  | 'not_in'
  | 'contains'
  | 'not contains'
  | 'regex'
  | 'not regex'
  | 'has'
  | '>'
  | '<'
  | '>='
  | '<=';

export type ValueAs = 'values' | 'counts' | 'rates_per_second' | 'count_over_time' | 'last_over_time';

export const VALUE_AS_OPTIONS: Array<{ label: string; value: ValueAs }> = [
  { label: 'Values', value: 'values' },
  { label: 'Counts', value: 'counts' },
  { label: 'Rate (per second)', value: 'rates_per_second' },
  { label: 'Count over time', value: 'count_over_time' },
];

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
export const NUMERIC_OPERATORS: Operator[] = ['=', '>', '<', '>=', '<='];

export interface Filter {
  tag: string;
  op: Operator;
  value: string[];
  dataType?: 'string' | 'number';
  extracted?: boolean;
  computed?: boolean;
}

export type LogsDirection = 'backward' | 'forward';

export type ValueThresholdOperator = '>' | '<' | '>=' | '<=';

export const VALUE_THRESHOLD_OPTIONS: Array<{ label: string; value: ValueThresholdOperator }> = [
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '≥', value: '>=' },
  { label: '≤', value: '<=' },
];

export interface ValueThreshold {
  enabled: boolean;
  operator: ValueThresholdOperator;
  value: number;
}

export interface SeriesSummary {
  label: string;
  tags: Record<string, unknown>;
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface MyQuery extends DataQuery {
  aggregationManuallyDeleted: any;
  filters?: Filter[];
  groupBy?: string[];
  queryText?: string;
  constant?: number;
  mode?: 'logs' | 'metrics' | 'traces';
  metricName?: string;
  metricType?: 'gauge' | 'count' | 'histogram';
  aggregation?: Aggregation;
  chartAggregation?: ChartAggregation;
  valueAs?: ValueAs;
  promqlModel?: string;
  promqlDescription?: string;
  promqlOutput?: string;
  promqlEdited?: boolean;
  promqlSubTab?: 'builder' | 'code';
  logqlAggregation?: Aggregation;
  logqlOutput?: string;
  logqlBuilderExp?: string;
  logqlEdited?: boolean;
  logqlSubTab?: 'builder' | 'code';
  direction?: LogsDirection;
  timeFrom?: number;
  tracesSubTab?: 'builder' | 'code';
  tracesOutput?: string;
  tracesEdited?: boolean;
  tracesBuilderExp?: string;
  tracesActive?: 'builder' | 'code';
  timeTo?: number;
  selectedExemplar?: string | null;
  selectedFingerprint?: string;
  chartField?: string;
  fields?: string[];
  builderFields?: string[];
  codeFields?: string[];
  extractor?: {
    regex: string;
    logqlRegex?: string;
    fields: string[];
    selections: Array<{
      index: number;
      recognizerName: string;
      dataType: 'string' | 'number';
      label: string;
      userSelected: boolean;
    }>;
  };
  valueThreshold?: ValueThreshold;
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
  enableTraces?: boolean;
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
