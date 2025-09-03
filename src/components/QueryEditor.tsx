import { QueryEditorProps } from '@grafana/data';
import {
  Collapse,
  Combobox,
  Icon,
  InlineField,
  InlineFieldRow,
  LinkButton,
  Select,
  Spinner,
  Tab,
  TabsBar,
} from '@grafana/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataSource } from '../datasource';
import { fetchMetricNames, toInternalLabel } from '../services/logs';
import { AGGREGATE_OPTIONS, Aggregation, Filter, MyDataSourceOptions, MyQuery, Operator, ValueAs } from '../types';
import { FilterRow } from './FilterRow';
import { useLogFingerprints } from '../hooks/useLogFingerprints';
import { SelectedLogModal } from './SelectedLogModal';
import { css } from '@emotion/css';
import Promql from './PromQL';
import { promqlFromGraphPayload } from '../util/PromqlBuilder';
import { buildNestedFilter } from '../util/buildNestedFilter';
import { PrismPromQLEditor } from './PrismEditor';

type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';
type UiMetricType = MyQuery['metricType'];
type Mode = 'logs' | 'metrics' | 'promQL' | 'traces';

const toUiMetricType = (k?: MetricKind): UiMetricType => {
  switch (k) {
    case 'gauge':
      return 'gauge';
    case 'histogram':
      return 'histogram';
    case 'sum':
    case 'counter':
      return 'count';
    case 'summary':
      return 'histogram';
    default:
      return undefined;
  }
};

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
  datasource,
  range,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const [labelsRefreshKey, setLabelsRefreshKey] = useState(0);
  const showPromql = datasource.isPromQLEnabled();
  const showTraces = datasource.isTracesEnabled();
  const [isWaiting, setIsWaiting] = useState(false);
  const [selectedExemplar, setSelectedExemplar] = useState<string | null>(query.selectedExemplar ?? null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTimeRange, setModalTimeRange] = useState<{ startTime: number; endTime: number } | null>(null);
  const [isCollapseOpen, setIsCollapseOpen] = useState(!!query.selectedExemplar);
  const previousFiltersRef = useRef<Filter[]>([]);
  const [chartField, setChartField] = useState<string | null>(query.chartField ?? null);
  const [chartAggregation, setChartAggregation] = useState<Aggregation>(query.chartAggregation ?? 'sum');
  const [aggregation, setAggregation] = useState<Aggregation>(
    query.aggregation ?? (query.metricType === 'count' ? 'sum' : 'max')
  );
  const [extractedNumericFields, setExtractedNumericFields] = useState<string[]>([]);
  const [metricOptions, setMetricOptions] = useState<Array<{ metricName: string; metricType: MetricKind }>>([]);
  const lastMetricsKeyRef = useRef<string>('');
  const { bodies, fingerprints } = useLogFingerprints(datasource, query.refId);
  const [promqlEverEdited, setPromqlEverEdited] = useState(false);
  const defaultAggFor = (mt?: UiMetricType): Aggregation | undefined =>
    mt === 'count' ? 'sum' : mt === 'gauge' || mt === 'histogram' ? 'max' : undefined;

  const defaultValueAsFor = (mt?: UiMetricType): ValueAs => (mt === 'count' ? 'rates_per_second' : 'values');

  const prevMetricRef = useRef<{ type?: UiMetricType; name?: string }>({
    type: query.metricType,
    name: query.metricName,
  });

  const handleAggregationChange = (next: Aggregation) => {
    setAggregation(next);
  };

  const filters: Filter[] = useMemo(() => {
    const remaining =
      query.filters?.filter((f) => f.tag !== '_cardinalhq.name' && f.tag !== '_cardinalhq.fingerprint') ?? [];
    return remaining.length > 0 ? remaining : [{ tag: '', op: '=' as Operator, value: [''] }];
  }, [query.filters]);

  const [promqlDraft, setPromqlDraft] = useState('');
  const [promqlDirty, setPromqlDirty] = useState(false);
  const prevBuilderRef = useRef<string>('');

  const [timeRange, setTimeRange] = useState<{ startTime: number | undefined; endTime: number | undefined }>({
    startTime: query.timeFrom ?? range?.from?.valueOf(),
    endTime: query.timeTo ?? range?.to?.valueOf(),
  });

  const exemplarOptions = useMemo(
    () =>
      bodies.map((b, i) => {
        const fp = fingerprints[i];
        const id = fp ? `fp:${fp}` : `body:${b}`;
        return { label: b, value: id };
      }),
    [bodies, fingerprints]
  );

  const selectedId = query.selectedFingerprint
    ? `fp:${query.selectedFingerprint}`
    : selectedExemplar
    ? `body:${selectedExemplar}`
    : undefined;

  useEffect(() => {
    if (!showPromql && (query.mode ?? 'logs') === 'promQL') {
      onChange({ ...query, mode: 'logs' });
    }
  }, [onChange, query, showPromql]);

  const promqlSubTab: 'builder' | 'AI-assisted' = query.promqlSubTab ?? 'builder';
  const isPromqlMode = showPromql && (query.mode ?? 'logs') === 'promQL';

  const isMetricsMode = query.mode === 'metrics' || (isPromqlMode && promqlSubTab === 'builder');
  const isTracesMode = query.mode === 'traces';

  useEffect(() => {
    if (previousFiltersRef.current.length === 0 && filters.length > 0) {
      previousFiltersRef.current = filters;
    }
  }, [filters]);

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
    if (!isMetricsMode) {
      return;
    }

    if (lastMetricsKeyRef.current === 'metrics-init') {
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
        lastMetricsKeyRef.current = 'metrics-init';
      })
      .catch(() => {});
    return () => controller.abort();
  }, [datasource.id, isMetricsMode, setIsWaiting, timeRange.startTime, timeRange.endTime]);

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
    if (chartAggregation !== query.chartAggregation) {
      onChange({ ...query, chartAggregation });
    }
  }, [chartAggregation, onChange, query]);

  const hasExtraction =
    !!query.extractor || !!query.chartField || !!selectedExemplar || extractedNumericFields.length > 0;

  const resetExtraction = () => {
    const prevExtractedNames =
      (query.extractor?.fields ?? [])
        .map((f) => f)
        .map((f: any) => (typeof f === 'string' ? f : f.name))
        .filter((n: string) => n && !/^var_/.test(n)) || [];

    const prevExtractedInternal = new Set(prevExtractedNames.map((n) => toInternalLabel(n)));
    const scrubFilterTag = (tag?: string) => !prevExtractedInternal.has(toInternalLabel(tag || ''));

    const scrubbedFilters = (query.filters ?? [])
      .filter((f) => scrubFilterTag(f.tag))
      .filter((f) => f.tag !== '_cardinalhq.fingerprint');

    const scrubbedGroupBy = (query.groupBy ?? []).filter((g) => scrubFilterTag(g));

    const nextChartField = chartField && !prevExtractedInternal.has(toInternalLabel(chartField)) ? chartField : null;

    setExtractedNumericFields([]);
    setChartField(nextChartField);
    setChartAggregation('sum');
    setSelectedExemplar(null);
    setIsCollapseOpen(false);
    onChange({
      ...query,
      extractor: undefined,
      filters: scrubbedFilters.length ? scrubbedFilters : [{ tag: '', op: '=' as Operator, value: [''] }],
      groupBy: scrubbedGroupBy,
      chartField: nextChartField ?? undefined,
      chartAggregation: nextChartField ? query.chartAggregation ?? 'sum' : undefined,
      selectedExemplar: undefined,
    });
    setLabelsRefreshKey((k) => k + 1);
  };

  useEffect(() => {
    if (!isMetricsMode) {
      return;
    }

    if (query.aggregation != null) {
      setAggregation(query.aggregation);
    } else {
      const def = defaultAggFor(query.metricType);
      if (def) {
        setAggregation(def);
        onChange({ ...query, aggregation: def });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMetricsMode]);

  useEffect(() => {
    if (!isMetricsMode) {
      return;
    }

    const prev = prevMetricRef.current;
    const typeChanged = query.metricType !== prev.type;
    const nameChanged = query.metricName !== prev.name;

    if (typeChanged || nameChanged) {
      const def = defaultAggFor(query.metricType);
      if (def) {
        setAggregation(def);
        onChange({ ...query, aggregation: def });
      }
      prevMetricRef.current = { type: query.metricType, name: query.metricName };
    }
  }, [isMetricsMode, query.metricType, query.metricName, onChange, query]);

  useEffect(() => {
    if (aggregation !== query.aggregation) {
      onChange({ ...query, aggregation });
    }
  }, [aggregation, onChange, query]);

  useEffect(() => {
    if (!isMetricsMode) {
      return;
    }

    if (!query.valueAs) {
      onChange({ ...query, valueAs: defaultValueAsFor(query.metricType) });
      return;
    }

    if (query.metricType === 'count') {
      if (!(query.valueAs === 'counts' || query.valueAs === 'rates_per_second')) {
        onChange({ ...query, valueAs: defaultValueAsFor('count') });
      }
    } else {
      if (query.valueAs !== 'values') {
        onChange({ ...query, valueAs: 'values' });
      }
    }
  }, [isMetricsMode, onChange, query, query.metricType]);

  const promqlPreview = useMemo(() => {
    if (!(isPromqlMode && promqlSubTab === 'builder')) {
      return '';
    }

    const baseFilters =
      (query.filters ?? []).filter(
        (f) => f.tag?.trim() && Array.isArray(f.value) && f.value.some((v) => v?.trim?.())
      ) || [];

    const filtersWithMetric = query.metricName
      ? [{ tag: '_cardinalhq.name', op: '=' as Operator, value: [query.metricName] }, ...baseFilters]
      : baseFilters;

    const nested = buildNestedFilter(filtersWithMetric);
    if (!nested) {
      return '';
    }

    const valueAs: ValueAs = (query.valueAs ?? defaultValueAsFor(query.metricType)) as ValueAs;

    const effMetricType =
      query.metricType === 'count' && valueAs === 'rates_per_second' ? ('counter' as any) : query.metricType;

    const effAggregation: Aggregation = query.metricType === 'count' ? 'sum' : query.aggregation ?? 'max';

    const effRollup: Aggregation = query.metricType === 'count' ? 'sum' : query.aggregation ?? 'sum';

    const effType = query.metricType === 'count' ? (valueAs === 'rates_per_second' ? 'rate' : 'count') : 'count';

    const expression: any = {
      dataset: 'metrics',
      returnResults: true,
      filter: nested,
      metricType: effMetricType,
      chart: {
        aggregation: effAggregation,
        rollup: effRollup,
        groupBys: (query.groupBy ?? []).map(toInternalLabel),
        type: effType,
      },
    };

    const payload = { baseExpressions: { a: expression } };
    return promqlFromGraphPayload(payload) ?? '';
  }, [
    isPromqlMode,
    promqlSubTab,
    query.metricName,
    query.metricType,
    query.filters,
    query.groupBy,
    query.aggregation,
    query.valueAs,
  ]);

  useEffect(() => {
    if (!(isPromqlMode && promqlSubTab === 'builder')) {
      return;
    }

    const saved = (query.promqlOutput ?? '').trim();
    if (!saved) {
      return;
    }

    setPromqlDraft((prevDraft) => {
      if (prevDraft === saved) {
        return prevDraft;
      }
      setPromqlDirty((prevDirty) => (prevDirty ? prevDirty : true));
      return saved;
    });
  }, [isPromqlMode, promqlSubTab, query.promqlOutput]);

  useEffect(() => {
    if (!(isPromqlMode && promqlSubTab === 'builder')) {
      return;
    }

    const preview = (promqlPreview ?? '').trim();
    const savedOut = (query.promqlOutput ?? '').trim();
    const userHasCustom = promqlDirty || (!!savedOut && savedOut !== (prevBuilderRef.current ?? ''));

    if (!userHasCustom && preview) {
      if (promqlDraft !== preview) {
        setPromqlDraft(preview);
      }
      if (savedOut !== preview) {
        onChange({ ...query, promqlOutput: preview });
      }
    }

    prevBuilderRef.current = preview;
  }, [isPromqlMode, promqlSubTab, promqlPreview, promqlDirty, promqlDraft, query, onChange]);

  const filtersByModeRef = useRef<Record<Mode, Filter[]>>({
    logs: [],
    metrics: [],
    promQL: [],
    traces: [],
  });

  useEffect(() => {
    const mode = (query.mode ?? 'logs') as Mode;
    filtersByModeRef.current[mode] = filters;
  }, [filters, query.mode]);

  const availableTabs = useMemo<Mode[]>(() => {
    const tabs: Mode[] = ['logs', 'metrics'];
    if (showPromql) {
      tabs.push('promQL');
    }
    if (showTraces) {
      tabs.push('traces');
    }
    return tabs;
  }, [showPromql, showTraces]);

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

      <div style={{ marginBottom: 8 }}>
        <TabsBar>
          {availableTabs.map((mode) => (
            <Tab
              key={mode}
              label={mode.charAt(0).toUpperCase() + mode.slice(1)}
              active={(query.mode ?? 'logs') === mode}
              onChangeTab={() => {
                if (mode === 'promQL' && !showPromql) {
                  return;
                }

                const targetMode = mode;
                const wantDefaultFilter = targetMode !== 'promQL' || promqlSubTab === 'builder';
                onChange({
                  ...query,
                  mode: targetMode,
                  filters: wantDefaultFilter ? [{ tag: '', op: '=' as Operator, value: [''] }] : [],
                  groupBy: [],
                  chartField: undefined,
                  extractor: undefined,
                  metricName: undefined,
                  metricType: undefined,
                  valueAs: undefined,
                });
              }}
            />
          ))}
        </TabsBar>
      </div>

      {isMetricsMode && !isPromqlMode && (
        <InlineFieldRow>
          <InlineField label="Metric Name">
            <Select
              placeholder="Select a metric"
              options={metricOptions.map((m) => ({ label: m.metricName, value: m.metricName }))}
              value={query.metricName ? { label: query.metricName, value: query.metricName } : null}
              onChange={(opt) => {
                const val = opt?.value ?? '';
                const found = metricOptions.find((m) => m.metricName === val);
                const nextMetricType = toUiMetricType(found?.metricType);

                setPromqlDirty(true);
                onChange({
                  ...query,
                  metricName: val || undefined,
                  metricType: nextMetricType,
                  valueAs: defaultValueAsFor(nextMetricType),
                });
              }}
              width={40}
            />
          </InlineField>
        </InlineFieldRow>
      )}
      {!isPromqlMode &&
        filters.map((filter, index) => (
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
            addFilter={() =>
              onChange({ ...query, filters: [...filters, { tag: '', op: '=' as Operator, value: [''] }] })
            }
            updateGroupBy={(labels) => onChange({ ...query, groupBy: labels })}
            groupBy={query.groupBy ?? []}
            onRunQuery={onRunQuery}
            mode={query.mode}
            metricName={query.metricName}
            metricType={query.metricType}
            aggregation={aggregation}
            updateAggregation={handleAggregationChange}
            valueAs={isMetricsMode ? query.valueAs : undefined}
            updateValueAs={isMetricsMode ? (v: any) => onChange({ ...query, valueAs: v }) : undefined}
            setIsWaiting={setIsWaiting}
            extract={query.extractor}
            labelsRefreshKey={labelsRefreshKey}
            fingerprint={query.selectedFingerprint}
          />
        ))}

      {!isMetricsMode && !isPromqlMode && !isTracesMode && (
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
              <Select
                placeholder="Select a message"
                options={exemplarOptions}
                value={selectedId ? { label: selectedExemplar ?? '', value: selectedId } : null}
                isClearable
                width={80}
                onChange={(opt) => {
                  if (!opt?.value) {
                    setSelectedExemplar(null);
                    onChange({ ...query, selectedExemplar: undefined, selectedFingerprint: undefined });
                    return;
                  }

                  const val = String(opt.value);
                  if (val.startsWith('fp:')) {
                    const fp = val.slice(3);
                    const match = bodies[fingerprints.indexOf(fp)];
                    setSelectedExemplar(match ?? '');
                    onChange({ ...query, selectedExemplar: match, selectedFingerprint: fp });
                  } else if (val.startsWith('body:')) {
                    const body = val.slice(5);
                    setSelectedExemplar(body);
                    onChange({ ...query, selectedExemplar: body, selectedFingerprint: undefined });
                  }
                }}
              />
            </InlineField>
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
            <InlineField>
              <LinkButton
                variant="secondary"
                onClick={resetExtraction}
                disabled={!hasExtraction}
                style={{ marginLeft: 8 }}
              >
                Reset
              </LinkButton>
            </InlineField>
          </InlineFieldRow>
          {extractedNumericFields.length > 0 && (
            <InlineFieldRow style={{ marginTop: 8 }}>
              <InlineField label="Chart">
                <Combobox
                  options={extractedNumericFields.map((f) => ({ label: f, value: f }))}
                  value={chartField && extractedNumericFields.includes(chartField) ? chartField : ''}
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
                  onChange={(v) => setChartAggregation((v?.value as Aggregation) ?? 'sum')}
                  width={20}
                />
              </InlineField>
            </InlineFieldRow>
          )}
        </Collapse>
      )}

      {isPromqlMode && (
        <div>
          {/* <div style={{ marginTop: -8, marginBottom: 8 }}>
            <TabsBar>
              {(['builder', 'AI-assisted'] as const).map((sub) => (
                <Tab
                  key={sub}
                  label={sub.charAt(0).toUpperCase() + sub.slice(1)}
                  active={(query.promqlSubTab ?? 'builder') === sub}
                  onChangeTab={() => {
                    if (sub === 'builder') {
                      setPromqlDirty(false);
                    }
                    onChange({ ...query, promqlSubTab: sub });
                  }}
                />
              ))}
            </TabsBar>
          </div> */}

          {promqlSubTab === 'builder' ? (
            <>
              <InlineFieldRow>
                <InlineField label="Metric Name">
                  <Select
                    placeholder="Select a metric"
                    options={metricOptions.map((m) => ({ label: m.metricName, value: m.metricName }))}
                    value={query.metricName ? { label: query.metricName, value: query.metricName } : null}
                    onChange={(opt) => {
                      const val = opt?.value ?? '';
                      const found = metricOptions.find((m) => m.metricName === val);
                      const nextMetricType = toUiMetricType(found?.metricType);
                      setPromqlDirty(false);
                      onChange({
                        ...query,
                        metricName: val || undefined,
                        metricType: nextMetricType,
                        valueAs: defaultValueAsFor(nextMetricType),
                        promqlOutput: undefined,
                      });
                    }}
                    width={40}
                  />
                </InlineField>
              </InlineFieldRow>

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
                  addFilter={() => {
                    onChange({ ...query, filters: [...filters, { tag: '', op: '=' as Operator, value: [''] }] });
                  }}
                  updateGroupBy={(labels) => {
                    onChange({ ...query, groupBy: labels });
                  }}
                  groupBy={query.groupBy ?? []}
                  onRunQuery={onRunQuery}
                  mode={'metrics'}
                  metricName={query.metricName}
                  metricType={query.metricType}
                  aggregation={aggregation}
                  updateAggregation={handleAggregationChange}
                  valueAs={query.valueAs}
                  updateValueAs={(v) => {
                    onChange({ ...query, valueAs: v });
                  }}
                  setIsWaiting={setIsWaiting}
                />
              ))}

              {(promqlPreview || promqlDraft) && (
                <div style={{ marginTop: 8 }}>
                  <PrismPromQLEditor
                    value={promqlDraft}
                    language="promql"
                    height={40}
                    width="100%"
                    wordWrap
                    onChange={(val: any) => {
                      const next = (val ?? '').trimEnd();
                      if (!promqlDirty) {
                        setPromqlDirty(true);
                      }
                      if (!promqlEverEdited) {
                        setPromqlEverEdited(true);
                      }
                      setPromqlDraft(next);
                      if ((query.promqlOutput ?? '') !== next) {
                        onChange({ ...query, promqlOutput: next });
                      }
                    }}
                    onBlur={() => {
                      if ((query.promqlOutput ?? '') !== promqlDraft) {
                        onChange({ ...query, promqlOutput: promqlDraft });
                      }
                    }}
                  />

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex', marginTop: 6 }}>
                    {(promqlDirty || promqlEverEdited) && (
                      <LinkButton
                        variant="secondary"
                        disabled={!promqlDirty}
                        onClick={() => {
                          const next = (promqlPreview ?? '').trim();
                          setPromqlDirty(false);
                          setPromqlDraft(next);
                          if ((query.promqlOutput ?? '') !== next) {
                            onChange({ ...query, promqlOutput: next });
                          }
                        }}
                      >
                        Reset to builder output
                      </LinkButton>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <Promql
              datasourceId={datasource.id}
              description={query.promqlDescription ?? ''}
              output={query.promqlOutput ?? ''}
              onChange={(patch) =>
                onChange({
                  ...query,
                  promqlDescription: patch.description ?? query.promqlDescription,
                  promqlOutput: patch.output ?? query.promqlOutput,
                })
              }
            />
          )}
        </div>
      )}
      <SelectedLogModal
        logLine={selectedExemplar ?? ''}
        isOpen={isModalOpen}
        fingerprint={query.selectedFingerprint ?? ''}
        onClose={() => setIsModalOpen(false)}
        filters={query.filters || []}
        extractor={query.extractor}
        timeRange={{ startTime: modalTimeRange?.startTime ?? 0, endTime: modalTimeRange?.endTime ?? 0 }}
        datasourceId={datasource.id}
        onExtractionApply={(newExtractor, newTagFilters) => {
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
            filters: [
              ...(query.filters ?? []).filter((f) => f.tag !== '_cardinalhq.fingerprint'),
              ...(newTagFilters ?? []),
            ],
          });

          setLabelsRefreshKey((v) => v + 1);
          setIsCollapseOpen(true);
          onRunQuery();
        }}
      />
    </div>
  );
}
