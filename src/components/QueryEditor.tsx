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

import { QueryEditorProps } from '@grafana/data';
import { Tab, TabsBar } from '@grafana/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery, Filter } from '../types';
import { LogQLTab } from './LogQL';
import MetricsTab from './MetricsTab';
import TracesTab from './Traces';

type Mode = 'logs' | 'metrics' | 'traces';

const SERVICE_NAME_TAG = 'resource_service_name';
const DEFAULT_LOGS_FILTER = { tag: SERVICE_NAME_TAG, op: '=' as any, value: [''] };

const hasValidFilterValues = (filters: Filter[]): boolean => {
  return filters.some((f) => {
    if (!f.tag) {
      return false;
    }
    if (f.op === 'has') {
      return true;
    }
    return Array.isArray(f.value) && f.value.some((v) => v && v.trim());
  });
};

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
  datasource,
  range,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const [labelsRefreshKey, setLabelsRefreshKey] = useState(0);
  const [timeRange, setTimeRange] = useState<{ startTime: number | undefined; endTime: number | undefined }>({
    startTime: query.timeFrom ?? range?.from?.valueOf(),
    endTime: query.timeTo ?? range?.to?.valueOf(),
  });

  useEffect(() => {
    if (!query.timeFrom && !query.timeTo && range?.from && range?.to) {
      setTimeRange((prev) => {
        const newStart = range.from.valueOf();
        const newEnd = range.to.valueOf();
        return {
          startTime: Math.abs(newStart - (prev.startTime ?? 0)) > 1000 ? newStart : prev.startTime,
          endTime: Math.abs(newEnd - (prev.endTime ?? 0)) > 1000 ? newEnd : prev.endTime,
        };
      });
    }
  }, [range?.from, range?.to, query.timeFrom, query.timeTo]);

  const filters: Filter[] = useMemo(() => {
    const remaining = query.filters?.filter((f) => f.tag !== '_cardinalhq_name' && f.tag !== 'chq_fingerprint') ?? [];
    return remaining.length > 0 ? remaining : [{ tag: '', op: '=' as any, value: [''] }];
  }, [query.filters]);

  const stateByModeRef = useRef<
    Record<
      Mode,
      {
        filters: Filter[];
        groupBy: string[];
        aggregation?: any;
        logqlAggregation?: any;
        valueAs?: any;
        extractor?: any;
      }
    >
  >({
    logs: {
      filters: query.filters ?? [],
      groupBy: query.groupBy ?? [],
      aggregation: query.aggregation,
      logqlAggregation: query.logqlAggregation,
      valueAs: query.valueAs,
      extractor: query.extractor,
    },
    metrics: {
      filters: [],
      groupBy: [],
      aggregation: undefined,
      logqlAggregation: undefined,
      valueAs: undefined,
      extractor: undefined,
    },
    traces: {
      filters: [],
      groupBy: [],
      aggregation: undefined,
      logqlAggregation: undefined,
      valueAs: undefined,
      extractor: undefined,
    },
  });

  useEffect(() => {
    const mode = (query.mode ?? 'logs') as Mode;
    stateByModeRef.current[mode] = {
      filters,
      groupBy: query.groupBy ?? [],
      aggregation: query.aggregation,
      logqlAggregation: query.logqlAggregation,
      valueAs: query.valueAs,
      extractor: query.extractor,
    };
  }, [filters, query.mode, query.groupBy, query.aggregation, query.logqlAggregation, query.valueAs, query.extractor]);

  const availableTabs = useMemo<Mode[]>(() => ['logs', 'metrics', 'traces'], []);

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ marginBottom: 4 }}>
        <TabsBar>
          {availableTabs.map((mode) => (
            <Tab
              key={mode}
              label={mode.charAt(0).toUpperCase() + mode.slice(1)}
              active={(query.mode ?? 'logs') === mode}
              onChangeTab={() => {
                const targetMode = mode;
                const savedState = stateByModeRef.current[targetMode];
                let filters = savedState.filters;
                if (targetMode === 'logs' && (!filters || filters.length === 0 || !hasValidFilterValues(filters))) {
                  filters = [DEFAULT_LOGS_FILTER];
                }
                onChange({
                  ...query,
                  mode: targetMode,
                  filters,
                  groupBy: savedState.groupBy,
                  aggregation: savedState.aggregation,
                  logqlAggregation: savedState.logqlAggregation,
                  valueAs: savedState.valueAs,
                  extractor: savedState.extractor,
                  chartField: undefined,
                  metricName: undefined,
                  metricType: undefined,
                  promqlOutput: undefined,
                  promqlDescription: undefined,
                });
              }}
            />
          ))}
        </TabsBar>
      </div>

      {(query.mode ?? 'logs') === 'logs' && (
        <LogQLTab
          datasourceId={datasource.id}
          datasource={datasource}
          query={query}
          onChange={onChange}
          onRunQuery={onRunQuery}
          timeRange={timeRange}
          labelsRefreshKey={labelsRefreshKey}
          onLabelsRefresh={() => setLabelsRefreshKey((k) => k + 1)}
        />
      )}

      {query.mode === 'metrics' && (
        <MetricsTab
          datasource={datasource}
          query={query}
          onChange={onChange}
          onRunQuery={onRunQuery}
          timeRange={timeRange}
        />
      )}

      {query.mode === 'traces' && (
        <TracesTab
          datasourceId={datasource.id}
          datasource={datasource}
          query={query}
          onChange={onChange}
          onRunQuery={onRunQuery}
          timeRange={timeRange}
          labelsRefreshKey={labelsRefreshKey}
          onLabelsRefresh={() => setLabelsRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
