import { QueryEditorProps } from '@grafana/data';
import { Combobox, InlineField, InlineFieldRow, MultiSelect, Tab, TabsBar } from '@grafana/ui';
import React, { useMemo, useEffect, useState } from 'react';
import { DataSource } from '../datasource';
import { useLogLabels } from '../hooks/useLabels';
import { Filter, MyDataSourceOptions, MyQuery, Operator } from '../types';
import { FilterRow } from './FilterRow';
import { fetchMetricNames } from '../services/logs';

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
  datasource,
  range,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const isMetricsMode = query.mode === 'metrics';

  const filters: Filter[] = useMemo(() => {
    const remaining = query.filters?.filter((f) => f.tag !== '_cardinalhq.name') ?? [];
    return remaining.length > 0 ? remaining : [{ tag: '', op: '=' as Operator, value: [''] }];
  }, [query.filters]);

  const [timeRange, setTimeRange] = useState<{ startTime: number | undefined; endTime: number | undefined }>({
    startTime: query.timeFrom ?? range?.from?.valueOf(),
    endTime: query.timeTo ?? range?.to?.valueOf(),
  });
  // Update only if range changes in a meaningful way, and query doesn't have explicit times
  useEffect(() => {
    if (query.timeFrom || query.timeTo) {
      // If query has explicit times, don't update
      return;
    }
    if (range?.from && range?.to) {
      setTimeRange((prev) => {
        const prevStart = prev.startTime ?? 0;
        const prevEnd = prev.endTime ?? 0;
        const newStart = range.from.valueOf();
        const newEnd = range.to.valueOf();
        return {
          startTime: newStart - prevStart > 1000 ? newStart : prevStart,
          endTime: newEnd - prevEnd > 1000 ? newEnd : prevEnd,
        };
      });
    }
  }, [range?.from, range?.to, query.timeFrom, query.timeTo]);

  const { data: labels = [], isLoading: loadingLabels } = useLogLabels({
    datasource,
    filters,
    enabled: true,
    mode: query.mode,
    startTime: timeRange.startTime,
    endTime: timeRange.endTime,
  });

  const [metricOptions, setMetricOptions] = useState<Array<{ metricName: string; metricType: 'gauge' }>>([]);

  useEffect(() => {
    const controller = new AbortController();

    const loadMetrics = async () => {
      try {
        const metrics = await fetchMetricNames({
          datasourceId: datasource.id,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          signal: controller.signal,
        });
        setMetricOptions(metrics);
      } catch {}
    };

    if (isMetricsMode) {
      loadMetrics();
    }

    return () => controller.abort();
  }, [datasource.id, isMetricsMode, timeRange.startTime, timeRange.endTime]);

  const comboboxOptions = metricOptions.map((m) => ({
    label: m.metricName,
    value: m.metricName,
  }));

  const selectedValue = query.metricName ?? '';

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...query, filters: updated });
  };

  const addFilter = () => {
    const defaultTag = labels.find((l) => l !== '_cardinalhq.name') ?? '';
    const updated = [...filters, { tag: defaultTag, op: '=' as Operator, value: [''] }];
    onChange({ ...query, filters: updated });
  };

  const removeFilter = (index: number) => {
    const updated = [...filters];
    updated.splice(index, 1);
    onChange({ ...query, filters: updated });
  };

  return (
    <div>
      <TabsBar>
        {['logs', 'metrics'].map((mode) => (
          <Tab
            key={mode}
            label={mode.charAt(0).toUpperCase() + mode.slice(1)}
            active={query.mode === mode}
            onChangeTab={() => {
              onChange({
                ...query,
                mode: mode as 'logs' | 'metrics',
                filters: [{ tag: '', op: '=' as Operator, value: [''] }],
                groupBy: [],
                metricName: undefined,
                metricType: undefined,
              });
              onRunQuery();
            }}
          />
        ))}
      </TabsBar>

      {isMetricsMode && (
        <InlineFieldRow>
          <InlineField label="Metric">
            <Combobox
              options={comboboxOptions}
              value={selectedValue}
              onChange={(v) => {
                const selected = metricOptions.find((opt) => opt.metricName === v?.value);
                if (selected) {
                  onChange({
                    ...query,
                    metricName: selected.metricName,
                    metricType: selected.metricType,
                  });
                }
              }}
              width={40}
            />
          </InlineField>
        </InlineFieldRow>
      )}

      {filters.map((filter, index) => (
        <FilterRow
          datasource={datasource}
          key={index}
          index={index}
          filter={filter}
          filters={filters}
          labels={labels}
          loadingLabels={loadingLabels}
          updateFilter={updateFilter}
          removeFilter={removeFilter}
          addFilter={addFilter}
          onRunQuery={onRunQuery}
          mode={query.mode}
          metricName={query.metricName}
          metricType={query.metricType}
        />
      ))}

      <InlineFieldRow style={{ marginTop: 8 }}>
        <InlineField label="Group by" grow>
          <MultiSelect
            placeholder="Select labels"
            options={labels.map((l) => ({ label: l, value: l })).filter((l) => l.value !== '_cardinalhq.name')}
            value={query.groupBy ?? []}
            onChange={(v) => {
              const selected = v.map((item) => item.value).filter((val): val is string => Boolean(val));
              onChange({ ...query, groupBy: selected });
            }}
            width={40}
          />
        </InlineField>
      </InlineFieldRow>
    </div>
  );
}
