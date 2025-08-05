import { QueryEditorProps } from '@grafana/data';
import { Collapse, Combobox, Icon, InlineField, InlineFieldRow, LinkButton, Spinner, Tab, TabsBar } from '@grafana/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataSource } from '../datasource';
import { fetchMetricNames } from '../services/logs';
import { AGGREGATE_OPTIONS, Aggregation, Filter, MyDataSourceOptions, MyQuery, Operator } from '../types';
import { FilterRow } from './FilterRow';
import { useLogBodies } from '../hooks/useLogBodies';
import { SelectedLogModal } from './SelectedLogModal';
import { css } from '@emotion/css';

function areFiltersEqual(a: Filter[], b: Filter[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const normalize = (f: Filter) => `${f.tag}|${f.op}|${(f.value ?? []).join(',')}`;
  return [...a]
    .map(normalize)
    .sort()
    .every((v, i) => v === [...b].map(normalize).sort()[i]);
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
  const [chartField, setChartField] = useState<string | null>(query.chartField ?? null);
  const [chartAggregation, setChartAggregation] = useState<Aggregation>(query.chartAggregation ?? 'sum');
  const [aggregation, setAggregation] = useState<Aggregation>(query.aggregation ?? 'sum');
  const [extractedNumericFields, setExtractedNumericFields] = useState<string[]>([]);
  const [metricOptions, setMetricOptions] = useState<Array<{ metricName: string; metricType: 'gauge' }>>([]);
  const hasLoadedMetrics = useRef(false);
  const cacheVersion = datasource.getLogCacheVersion(query.refId);
  const { bodies, isLoading: bodiesLoading } = useLogBodies(datasource, query.refId, cacheVersion);

  const isMetricsMode = query.mode === 'metrics';
  const filters: Filter[] = useMemo(() => {
    const remaining = query.filters?.filter((f) => f.tag !== '_cardinalhq.name') ?? [];
    return remaining.length > 0 ? remaining : [{ tag: '', op: '=' as Operator, value: [''] }];
  }, [query.filters]);

  const [timeRange, setTimeRange] = useState<{ startTime: number | undefined; endTime: number | undefined }>({
    startTime: query.timeFrom ?? range?.from?.valueOf(),
    endTime: query.timeTo ?? range?.to?.valueOf(),
  });

  useEffect(() => {
    if (previousFiltersRef.current.length === 0 && filters.length > 0) {
      previousFiltersRef.current = filters;
    }
  }, [filters]);

  useEffect(() => {
    const filtersChanged = !areFiltersEqual(previousFiltersRef.current, filters);
    const exemplarStillPresent =
      !!query.selectedExemplar && (bodies.includes(query.selectedExemplar) || bodies.length === 0);

    if (filtersChanged) {
      setSelectedExemplar(null);
      setExtractedNumericFields([]);
      setChartField(null);
      onChange({ ...query, selectedExemplar: null, extractor: undefined, chartField: undefined });
    } else if (query.selectedExemplar && exemplarStillPresent && selectedExemplar !== query.selectedExemplar) {
      setSelectedExemplar(query.selectedExemplar);
    }
    previousFiltersRef.current = filters;
  }, [filters, bodies, selectedExemplar, onChange, query]);

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

  useEffect(() => {
    if (!isMetricsMode || hasLoadedMetrics.current) {
      return;
    }
    const controller = new AbortController();
    fetchMetricNames({
      datasourceId: datasource.id,
      startTime: timeRange.startTime,
      endTime: timeRange.endTime,
      signal: controller.signal,
      setIsWaiting,
    })
      .then((metrics) => {
        setMetricOptions(metrics);
        hasLoadedMetrics.current = true;
      })
      .catch(() => {});
    return () => controller.abort();
  }, [datasource.id, isMetricsMode, timeRange.startTime, timeRange.endTime]);

  useEffect(() => {
    const selections = query.extractor?.selections ?? [];
    const numericFields = selections
      .filter((s) => s.dataType === 'number' && s.label && !s.label.startsWith('var_'))
      .map((s) => s.label)
      .filter((v, i, self) => self.indexOf(v) === i);
    setExtractedNumericFields(numericFields);
    if (!query.chartField && numericFields.length > 0) {
      setChartField(numericFields[0]);
      onChange({ ...query, chartField: numericFields[0] });
    }
  }, [query.extractor, onChange, query.chartField, query]);

  useEffect(() => {
    if (aggregation !== query.aggregation) {
      onChange({ ...query, aggregation });
    }
  }, [aggregation, onChange, query]);

  useEffect(() => {
    if (chartAggregation !== query.chartAggregation) {
      onChange({ ...query, chartAggregation });
    }
  }, [chartAggregation, onChange, query]);

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
            onChangeTab={() =>
              onChange({
                ...query,
                mode: mode as 'logs' | 'metrics',
                filters: [{ tag: '', op: '=' as Operator, value: [''] }],
                groupBy: [],
                metricName: undefined,
                metricType: undefined,
              })
            }
          />
        ))}
      </TabsBar>

      {isMetricsMode && (
        <InlineFieldRow>
          <InlineField label="Metric Name">
            <Combobox
              options={metricOptions.map((m) => ({ label: m.metricName, value: m.metricName }))}
              value={query.metricName ?? ''}
              onChange={(v) => {
                const selected = metricOptions.find((opt) => opt.metricName === v?.value);
                if (selected) {
                  onChange({ ...query, metricName: selected.metricName, metricType: selected.metricType });
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
          updateFilter={(i, patch) => {
            const updated = [...filters];
            updated[i] = { ...updated[i], ...patch };
            onChange({ ...query, filters: updated });
          }}
          removeFilter={(i) => {
            const updated = [...filters];
            updated.splice(i, 1);
            onChange({ ...query, filters: updated });
          }}
          addFilter={() => onChange({ ...query, filters: [...filters, { tag: '', op: '=' as Operator, value: [''] }] })}
          updateGroupBy={(labels) => onChange({ ...query, groupBy: labels })}
          groupBy={query.groupBy ?? []}
          onRunQuery={onRunQuery}
          mode={query.mode}
          metricName={query.metricName}
          metricType={query.metricType}
          aggregation={aggregation}
          updateAggregation={setAggregation}
          setIsWaiting={setIsWaiting}
        />
      ))}
      {!isMetricsMode && (
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
                value={selectedExemplar ?? ''}
                onChange={(v) => {
                  setSelectedExemplar(v.value);
                  onChange({ ...query, selectedExemplar: v.value });
                  setIsCollapseOpen(true);
                }}
                width={60}
              />
            </InlineField>
            {selectedExemplar && bodies.includes(selectedExemplar) && (
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

          {extractedNumericFields.length > 0 && (
            <InlineFieldRow style={{ marginTop: 8 }}>
              <InlineField label="Chart">
                <Combobox
                  options={extractedNumericFields.map((f) => ({ label: f, value: f }))}
                  value={chartField}
                  onChange={(v) => {
                    const field = v?.value ?? null;
                    setChartField(field);
                    onChange({ ...query, chartField: field });
                  }}
                  width={30}
                />
              </InlineField>
              <InlineField label="Aggregation" style={{ marginLeft: 8 }}>
                <Combobox
                  options={AGGREGATE_OPTIONS}
                  value={chartAggregation}
                  onChange={(v) => setChartAggregation(v?.value as Aggregation)}
                  width={20}
                />
              </InlineField>
            </InlineFieldRow>
          )}
        </Collapse>
      )}
      <SelectedLogModal
        logLine={selectedExemplar!}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        filters={query.filters || []}
        extractor={query.extractor}
        timeRange={{ startTime: modalTimeRange?.startTime ?? 0, endTime: modalTimeRange?.endTime ?? 0 }}
        datasourceId={datasource.id}
        onExtractionApply={(newExtractor) => {
          const numericFields = newExtractor.selections
            .filter((s) => s.dataType === 'number')
            .map((s) => s.label)
            .filter((v, i, self) => v && self.indexOf(v) === i);
          const defaultField = numericFields[0] ?? null;
          setExtractedNumericFields(numericFields);
          setChartField(defaultField);
          setChartAggregation('sum');
          onChange({
            ...query,
            chartField: defaultField,
            chartAggregation: 'sum',
            extractor: {
              regex: newExtractor.regex,
              fields: newExtractor.fields,
              selections: newExtractor.selections,
            },
          });
          setIsCollapseOpen(true);
          onRunQuery();
        }}
      />
    </div>
  );
}
