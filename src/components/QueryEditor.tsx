import React, { useEffect, useMemo } from 'react';
import {
  MultiSelect,
  InlineFieldRow,
  InlineField,
  TabsBar,
  Tab,
  Combobox,
} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import {
  MyDataSourceOptions,
  MyQuery,
  Filter,
  Operator,
} from '../types';
import { useLogLabels } from '../hooks/useLabels';
import { FilterRow } from './FilterRow';

const metrics_metadata = [
  { metricName: "system.cpu.time", metricType: "rate" },
  { metricName: "process.runtime.cpython.cpu.utilization", metricType: "gauge" },
  { metricName: "http.client.duration", metricType: "histogram" },
  { metricName: "process.thread.count", metricType: "rate" },
  { metricName: "process.context_switches", metricType: "rate" },
  { metricName: "jvm.thread.count", metricType: "rate" },
  { metricName: "k8s.pod.network.errors", metricType: "rate" },
  { metricName: "jvm.class.unloaded", metricType: "rate" },
  { metricName: "process.memory.virtual", metricType: "rate" },
  { metricName: "api-gateway.movie_play_starts", metricType: "rate" },
  { metricName: "process.runtime.cpython.context_switches", metricType: "rate" },
  { metricName: "container.memory.usage", metricType: "gauge" },
  { metricName: "system.memory.usage", metricType: "gauge" },
  { metricName: "system.disk.time", metricType: "rate" },
  { metricName: "container.uptime", metricType: "rate" },
  { metricName: "k8s.volume.inodes.used", metricType: "gauge" },
  { metricName: "container.cpu.time", metricType: "rate" },
  { metricName: "jvm.memory.used", metricType: "rate" },
  { metricName: "paymentservice.payment_processing_failures", metricType: "rate" },
  { metricName: "otlp.exporter.seen", metricType: "rate" },
  { metricName: "system.disk.io", metricType: "rate" },
  { metricName: "jvm.memory.used_after_last_gc", metricType: "rate" },
  { metricName: "jvm.gc.duration", metricType: "histogram" },
  { metricName: "k8s.container.cpu_request_utilization", metricType: "gauge" },
  { metricName: "k8s.volume.available", metricType: "gauge" },
  { metricName: "k8s.volume.capacity", metricType: "gauge" },
  { metricName: "container.memory.rss", metricType: "gauge" },
  { metricName: "k8s.pod.filesystem.available", metricType: "gauge" },
  { metricName: "jvm.cpu.count", metricType: "rate" },
  { metricName: "k8s.node.cpu.time", metricType: "rate" },
  { metricName: "k8s.pod.cpu.time", metricType: "rate" },
  { metricName: "k8s.container.cpu_limit_utilization", metricType: "gauge" },
  { metricName: "k8s.node.network.errors", metricType: "rate" },
  { metricName: "container.memory.available", metricType: "gauge" },
  { metricName: "processedLogs", metricType: "rate" },
  { metricName: "k8s.node.memory.usage", metricType: "gauge" },
  { metricName: "jvm.class.loaded", metricType: "rate" },
  { metricName: "system.network.dropped_packets", metricType: "rate" },
  { metricName: "k8s.node.filesystem.capacity", metricType: "gauge" },
  { metricName: "k8s.pod.memory.available", metricType: "gauge" },
  { metricName: "k8s.pod.filesystem.usage", metricType: "gauge" },
  { metricName: "system.network.io", metricType: "rate" },
  { metricName: "process.runtime.cpython.thread_count", metricType: "rate" },
  { metricName: "jvm.memory.committed", metricType: "rate" },
  { metricName: "system.memory.utilization", metricType: "gauge" },
  { metricName: "system.thread_count", metricType: "gauge" },
  { metricName: "container.filesystem.available", metricType: "gauge" },
  { metricName: "k8s.pod.network.io", metricType: "rate" },
  { metricName: "k8s.node.memory.rss", metricType: "gauge" },
  { metricName: "process.cpu.utilization", metricType: "gauge" },
  { metricName: "k8s.pod.memory.major_page_faults", metricType: "gauge" },
  { metricName: "system.swap.usage", metricType: "gauge" },
  { metricName: "processedSpans", metricType: "rate" },
  { metricName: "k8s.volume.inodes.free", metricType: "gauge" },
  { metricName: "http.server.duration", metricType: "histogram" },
  { metricName: "k8s.pod.uptime", metricType: "rate" },
  { metricName: "k8s.node.cpu.usage", metricType: "gauge" },
  { metricName: "system.network.packets", metricType: "rate" },
  { metricName: "k8s.node.memory.working_set", metricType: "gauge" },
  { metricName: "system.network.errors", metricType: "rate" },
  { metricName: "k8s.node.filesystem.available", metricType: "gauge" },
  { metricName: "system.network.connections", metricType: "rate" },
  { metricName: "container.cpu.usage", metricType: "gauge" },
  { metricName: "process.memory.usage", metricType: "rate" },
  { metricName: "process.open_file_descriptor.count", metricType: "rate" },
  { metricName: "api-gateway.movie_play_errors", metricType: "rate" },
  { metricName: "k8s.pod.memory.usage", metricType: "gauge" },
  { metricName: "container.filesystem.usage", metricType: "gauge" },
  { metricName: "process.runtime.cpython.cpu_time", metricType: "rate" },
  { metricName: "http.server.active_requests", metricType: "rate" },
  { metricName: "k8s.node.memory.available", metricType: "gauge" },
  { metricName: "container.memory.working_set", metricType: "gauge" },
  { metricName: "k8s.pod.cpu.usage", metricType: "gauge" },
  { metricName: "container.filesystem.capacity", metricType: "gauge" },
  { metricName: "license-service.license_validations", metricType: "rate" },
  { metricName: "k8s.volume.inodes", metricType: "gauge" },
  { metricName: "jvm.memory.limit", metricType: "rate" },
  { metricName: "http.client.request.duration", metricType: "histogram" },
  { metricName: "k8s.pod.memory.working_set", metricType: "gauge" },
  { metricName: "jvm.class.count", metricType: "rate" },
  { metricName: "k8s.pod.memory.page_faults", metricType: "gauge" },
  { metricName: "k8s.pod.filesystem.capacity", metricType: "gauge" },
  { metricName: "k8s.node.memory.page_faults", metricType: "gauge" },
  { metricName: "queueSize", metricType: "gauge" },
  { metricName: "process.cpu.time", metricType: "rate" },
  { metricName: "checkoutservice.checkout_requests", metricType: "rate" },
  { metricName: "k8s.node.network.io", metricType: "rate" },
  { metricName: "k8s.node.filesystem.usage", metricType: "gauge" },
  { metricName: "container.memory.page_faults", metricType: "gauge" },
  { metricName: "process.runtime.cpython.memory", metricType: "rate" },
  { metricName: "http.server.request.duration", metricType: "histogram" },
  { metricName: "system.disk.operations", metricType: "rate" },
  { metricName: "jvm.cpu.time", metricType: "rate" },
  { metricName: "container.memory.major_page_faults", metricType: "gauge" },
  { metricName: "jvm.cpu.recent_utilization", metricType: "gauge" },
  { metricName: "system.swap.utilization", metricType: "gauge" },
  { metricName: "k8s.node.memory.major_page_faults", metricType: "gauge" },
  { metricName: "k8s.container.memory_limit_utilization", metricType: "gauge" },
  { metricName: "otlp.exporter.exported", metricType: "rate" },
  { metricName: "k8s.container.memory_request_utilization", metricType: "gauge" },
  { metricName: "k8s.pod.memory.rss", metricType: "gauge" },
  { metricName: "process.runtime.cpython.gc_count", metricType: "rate" },
  { metricName: "system.cpu.utilization", metricType: "gauge" }
];


export function QueryEditor({
  query,
  onChange,
  onRunQuery,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const isMetricsMode = query.mode === 'metrics';

  const filters: Filter[] = useMemo(() => {
    const existing = query.filters?.filter(f => f.tag !== '_cardinalhq.name') ?? [];
    if (!existing.length) {
      return [{ tag: '', op: '=' as Operator, value: [''] }];
    }
    return existing;
  }, [query.filters]);

  const { data: labels = [], isLoading: loadingLabels } = useLogLabels({
    enabled: query.mode !== 'metrics' || !!query.metricName,
    filters,
    mode: query.mode,
  });

  useEffect(() => {
    if (filters.length === 0 && labels.length > 0 && query.mode !== 'metrics') {
      const defaultTag = labels[0];
      onChange({
        ...query,
        filters: [{ tag: defaultTag, op: '=' as Operator, value: [''] }],
      });
      onRunQuery();
    }
  }, [filters, labels, query, onChange, onRunQuery]);

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const addFilter = () => {
    if (isMetricsMode) { return; }
    const defaultTag = labels.find(l => l !== '_cardinalhq.name') ?? '';
    const updated = [...filters, { tag: defaultTag, op: '=' as Operator, value: [''] }];
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const removeFilter = (index: number) => {
    const updated = [...filters];
    updated.splice(index, 1);
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const metricOptions = metrics_metadata.map((m) => ({
    label: m.metricName,
    value: m.metricName,
    metricType: m.metricType,
  }));
  const comboboxOptions = metricOptions.map((m) => ({
    label: m.label,
    value: m.value ?? '',
  }));
  const selectedValue = query.metricName ?? '';


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
                filters: [],
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
                const selected = metricOptions.find((opt) => opt.value === v?.value);
                if (selected) {
                  onChange({
                    ...query,
                    metricName: selected.value,
                    metricType: selected.metricType as 'rate' | 'gauge' | 'histogram',
                    filters: [],
                  });
                  onRunQuery();
                }
              }}
              width={40}
            />
          </InlineField>
        </InlineFieldRow>
      )}

      {filters.map((filter, index) => (
        <FilterRow
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
            options={labels.map((l) => ({ label: l, value: l })).filter(l => l.value !== '_cardinalhq.name')}
            value={query.groupBy ?? []}
            onChange={(v) => {
              const selected = v.map((item) => item.value).filter((val): val is string => Boolean(val));
              onChange({ ...query, groupBy: selected });
              onRunQuery();
            }}
            width={40}
          />
        </InlineField>
      </InlineFieldRow>
    </div>
  );
}
