import { QueryEditorProps } from '@grafana/data';
import { Collapse, Combobox, Icon, InlineField, InlineFieldRow, LinkButton, Spinner, Tab, TabsBar } from '@grafana/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataSource } from '../datasource';
import { fetchMetricNames } from '../services/logs';
import { Filter, MyDataSourceOptions, MyQuery, Operator } from '../types';
import { FilterRow } from './FilterRow';
import { useLogBodies } from '../hooks/useLogBodies';
import { SelectedLogModal } from './SelectedLogModal';
import { css } from '@emotion/css';

function areFiltersEqual(a: Filter[], b: Filter[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const normalize = (f: Filter) => `${f.tag}|${f.op}|${(f.value ?? []).join(',')}`;
  const sortedA = [...a].map(normalize).sort();
  const sortedB = [...b].map(normalize).sort();

  return sortedA.every((v, i) => v === sortedB[i]);
}

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
  datasource,
  range,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const [isWaiting, setIsWaiting] = useState(false);
  const [selectedExemplar, setSelectedExemplar] = useState<string | null>(query.selectedExemplar ?? null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTimeRange, setModalTimeRange] = useState<{ startTime: number; endTime: number } | null>(null);
  const [isCollapseOpen, setIsCollapseOpen] = useState(!!query.selectedExemplar);
  const previousFiltersRef = useRef<Filter[]>([]);

  const isMetricsMode = query.mode === 'metrics';
  const aggregation = query.aggregation ?? '';
  const updateAggregation = (agg: 'avg' | 'sum' | 'min' | 'max') => {
    onChange({ ...query, aggregation: agg });
  };
  const filters: Filter[] = useMemo(() => {
    const remaining = query.filters?.filter((f) => f.tag !== '_cardinalhq.name') ?? [];
    return remaining.length > 0 ? remaining : [{ tag: '', op: '=' as Operator, value: [''] }];
  }, [query.filters]);

  const [timeRange, setTimeRange] = useState<{ startTime: number | undefined; endTime: number | undefined }>({
    startTime: query.timeFrom ?? range?.from?.valueOf(),
    endTime: query.timeTo ?? range?.to?.valueOf(),
  });
  useEffect(() => {
    if (!areFiltersEqual(previousFiltersRef.current, filters)) {
      previousFiltersRef.current = filters;
      setSelectedExemplar(null);
      onChange({ ...query, selectedExemplar: null });
    }
  }, [filters, onChange, query]);

  useEffect(() => {
    if (query.timeFrom || query.timeTo) {
      return;
    }

    if (range?.from && range?.to) {
      setTimeRange((prev) => {
        const newStart = range.from.valueOf();
        const newEnd = range.to.valueOf();
        const updated = {
          startTime: Math.abs(newStart - (prev.startTime ?? 0)) > 1000 ? newStart : prev.startTime,
          endTime: Math.abs(newEnd - (prev.endTime ?? 0)) > 1000 ? newEnd : prev.endTime,
        };
        return updated;
      });
    }
  }, [range?.from, range?.to, query.timeFrom, query.timeTo]);

  const [metricOptions, setMetricOptions] = useState<Array<{ metricName: string; metricType: 'gauge' }>>([]);
  const hasLoadedMetrics = useRef(false);

  useEffect(() => {
    if (!isMetricsMode || hasLoadedMetrics.current) {
      return;
    }

    const controller = new AbortController();

    const loadMetrics = async () => {
      try {
        const metrics = await fetchMetricNames({
          datasourceId: datasource.id,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
          signal: controller.signal,
          setIsWaiting,
        });
        setMetricOptions(metrics);
        hasLoadedMetrics.current = true;
      } catch (err) {}
    };

    loadMetrics();

    return () => controller.abort();
  }, [datasource.id, isMetricsMode, timeRange.startTime, timeRange.endTime]);

  const comboboxOptions =
    isWaiting || metricOptions.length === 0
      ? [{ label: 'Loading...', value: '__loading' }]
      : metricOptions
          .map((m) => ({ label: m.metricName, value: m.metricName }))
          .sort((a, b) => a.label.localeCompare(b.label));

  const selectedValue = query.metricName ?? '';

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...query, filters: updated });
  };

  const addFilter = () => {
    const updated = [...filters, { tag: '', op: '=' as Operator, value: [''] }];
    onChange({ ...query, filters: updated });
  };

  const removeFilter = (index: number) => {
    const updated = [...filters];
    updated.splice(index, 1);
    onChange({ ...query, filters: updated });
  };
  const cacheVersion = datasource.getLogCacheVersion(query.refId);
  const { bodies, isLoading: bodiesLoading } = useLogBodies(datasource, query.refId, cacheVersion);

  return (
    <div style={{ position: 'relative' }}>
      {isWaiting && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(34, 37, 43, 0.6)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'all',
            color: 'white',
          }}
        >
          <Spinner />
          <div style={{ marginTop: 8, fontWeight: 'bold' }}>Waiting for scale-up...</div>
        </div>
      )}
      <TabsBar>
        {['logs', 'metrics'].map((mode) => (
          <Tab
            key={mode}
            label={mode.charAt(0).toUpperCase() + mode.slice(1)}
            active={(query.mode ?? 'logs') === mode}
            onChangeTab={() => {
              const next = {
                ...query,
                mode: mode as 'logs' | 'metrics',
                filters: [{ tag: '', op: '=' as Operator, value: [''] }],
                groupBy: [],
                metricName: undefined,
                metricType: undefined,
              };
              onChange(next);
            }}
          />
        ))}
      </TabsBar>

      {isMetricsMode && (
        <InlineFieldRow>
          <InlineField label="Metric Name">
            <Combobox
              options={comboboxOptions}
              value={selectedValue}
              onChange={(v) => {
                if (v?.value === '__loading') {
                  return;
                }
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
          key={index}
          index={index}
          datasource={datasource}
          filter={filter}
          filters={filters}
          startTime={timeRange.startTime}
          endTime={timeRange.endTime}
          updateFilter={updateFilter}
          removeFilter={removeFilter}
          addFilter={addFilter}
          updateGroupBy={(labels) => onChange({ ...query, groupBy: labels })}
          groupBy={query.groupBy ?? []}
          onRunQuery={onRunQuery}
          mode={query.mode}
          metricName={query.metricName}
          metricType={query.metricType}
          aggregation={aggregation}
          updateAggregation={updateAggregation}
          setIsWaiting={setIsWaiting}
        />
      ))}
      <Collapse
        label={
          <div className={css({ display: 'flex', alignItems: 'center', gap: 8 })}>
            <Icon name={isCollapseOpen ? 'angle-down' : 'angle-right'} />
            <span>Extract tags from message</span>
          </div>
        }
        isOpen={isCollapseOpen}
        onToggle={() => setIsCollapseOpen((prev) => !prev)}
      >
        <InlineFieldRow>
          <InlineField label="Select Message">
            <Combobox
              loading={bodiesLoading}
              options={bodies.map((b) => ({ label: b, value: b }))}
              value={query.selectedExemplar ?? ''}
              onChange={(v) => {
                setSelectedExemplar(v.value);
                onChange({ ...query, selectedExemplar: v.value });
                setIsCollapseOpen(true);
              }}
              width={60}
            />
          </InlineField>
          {selectedExemplar && (
            <InlineField>
              <LinkButton
                variant="secondary"
                onClick={() => {
                  setModalTimeRange({
                    startTime: timeRange.startTime ?? Date.now() - 5 * 60 * 1000,
                    endTime: timeRange.endTime ?? Date.now(),
                  });
                  setIsModalOpen(true);
                }}
                style={{ marginLeft: 8 }}
              >
                Extract tags
              </LinkButton>
            </InlineField>
          )}
        </InlineFieldRow>
      </Collapse>

      <SelectedLogModal
        logLine={selectedExemplar!}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        filters={query.filters || []}
        extractor={query.extractor}
        timeRange={{
          startTime: modalTimeRange?.startTime ?? 0,
          endTime: modalTimeRange?.endTime ?? 0,
        }}
        datasourceId={datasource.id}
        onExtractionApply={(newExtractor) => {
          onChange({
            ...query,
            extractor: {
              ...newExtractor,
              selections: newExtractor.selections,
              regex: newExtractor.regex,
              fields: newExtractor.fields,
            },
          });
          onRunQuery();
        }}
      />
    </div>
  );
}
