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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { InlineField, InlineFieldRow, Combobox, Tab, TabsBar, Input, Switch } from '@grafana/ui';
import { DataSource } from '../datasource';
import { Filter, MyQuery, Operator, VALUE_THRESHOLD_OPTIONS, ValueThresholdOperator } from '../types';
import { PrismPromQLEditor } from './PrismEditor';
import { promqlFromQueryBuilder } from '../util/MetricsBuilder';
import { FilterBuilder } from './FilterTags';
import { useMetricNames } from '../hooks/useMetricNames';

type UiMetricType = MyQuery['metricType'];
type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';
//metric type
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

const HIDDEN_TAGS = new Set<string>(['chq_fingerprint', '_cardinalhq_fingerprint', '_cardinalhq_name']);
const isHiddenTag = (t?: string) => !!t && HIDDEN_TAGS.has(t.replace(/^"|"$/g, ''));

export function MetricsTab(props: {
  datasource: DataSource;
  query: MyQuery;
  onChange: (q: MyQuery) => void;
  onRunQuery: () => void;
  timeRange?: { startTime: number | undefined; endTime: number | undefined };
  setIsWaiting?: (v: boolean) => void;
}) {
  const { datasource, query, onChange, timeRange, setIsWaiting } = props;
  const subTab: 'builder' | 'code' = (query.promqlSubTab as any) ?? 'builder';

  const { data: metricOptions = [] } = useMetricNames(datasource.id, setIsWaiting);

  const visibleFilters: Filter[] = useMemo(
    () => (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)),
    [query.filters]
  );

  const filters: Filter[] = useMemo(() => {
    return visibleFilters.length > 0 ? visibleFilters : [{ tag: '', op: '=' as Operator, value: [''] }];
  }, [visibleFilters]);

  const [codeDraft, setCodeDraft] = useState<string>(query.promqlOutput ?? '');
  const [lastBuilderExpr, setLastBuilderExpr] = useState<string>('');

  const latestQueryRef = useRef(query);
  useEffect(() => {
    latestQueryRef.current = query;
  }, [query]);

  const promqlPreview = useMemo(() => {
    try {
      return promqlFromQueryBuilder(query);
    } catch {
      return '';
    }
  }, [query]);

  const prevDsRef = useRef(datasource.id);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (prevDsRef.current !== datasource.id) {
      prevDsRef.current = datasource.id;
      onChangeRef.current({
        ...queryRef.current,
        metricName: undefined,
        promqlOutput: undefined,
        promqlEdited: false,
        promqlSubTab: 'builder',
      });
      setCodeDraft('');
      setLastBuilderExpr('');
    }
  }, [datasource.id]);

  useEffect(() => {
    if (subTab !== 'builder') {
      return;
    }
    const shouldUpdate =
      (!query.promqlEdited || query.promqlSubTab === 'builder') && promqlPreview !== query.promqlOutput;

    if (shouldUpdate) {
      setLastBuilderExpr(promqlPreview);
      setCodeDraft(promqlPreview);
      onChange({
        ...query,
        promqlSubTab: 'builder',
        promqlOutput: promqlPreview,
        promqlEdited: false,
      });
    }
  }, [subTab, promqlPreview, query, onChange]);

  useEffect(() => {
    if (subTab === 'code' && !query.promqlEdited) {
      setCodeDraft(lastBuilderExpr || query.promqlOutput || '');
    }
  }, [subTab, query.promqlEdited, query.promqlOutput, lastBuilderExpr]);

  const effectiveTimeRange = timeRange || { startTime: query.timeFrom, endTime: query.timeTo };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <TabsBar>
          {(['builder', 'code'] as const).map((t) => (
            <Tab
              key={t}
              label={t === 'builder' ? 'Builder' : 'Code'}
              active={subTab === t}
              onChangeTab={() => {
                if (t === 'builder') {
                  onChange({
                    ...query,
                    promqlSubTab: 'builder',
                    promqlOutput: promqlPreview,
                    promqlEdited: false,
                  });
                } else {
                  onChange({
                    ...query,
                    promqlSubTab: 'code',
                    promqlOutput: codeDraft,
                    promqlEdited: true,
                  });
                }
              }}
            />
          ))}
        </TabsBar>
      </div>

      {subTab === 'builder' && (
        <>
          <InlineFieldRow>
            <InlineField label="Metric Name">
              <Combobox
                placeholder="Select a metric"
                options={metricOptions.map((m) => ({ label: m.metricName, value: m.metricName }))}
                value={query.metricName ?? null}
                onChange={(opt) => {
                  const val = opt?.value ?? '';
                  const found = metricOptions.find((m) => m.metricName === val);
                  const nextMetricType = toUiMetricType(found?.metricType);
                  let newAggregation = query.aggregation;
                  let newValueAs = query.valueAs;
                  if (nextMetricType === 'count') {
                    newAggregation = 'sum';
                    newValueAs = 'rates_per_second';
                  } else if (nextMetricType === 'gauge' || nextMetricType === 'histogram') {
                    newAggregation = 'max';
                    newValueAs = 'values';
                  }

                  const nextExpr = promqlFromQueryBuilder({
                    ...query,
                    metricName: val || undefined,
                    metricType: nextMetricType,
                    aggregation: newAggregation,
                    valueAs: newValueAs,
                  });

                  setLastBuilderExpr(nextExpr);
                  setCodeDraft(nextExpr);

                  onChange({
                    ...query,
                    metricName: val || undefined,
                    metricType: nextMetricType,
                    aggregation: newAggregation,
                    valueAs: newValueAs,
                    promqlOutput: nextExpr,
                    promqlEdited: false,
                  });
                }}
                width={40}
              />
            </InlineField>
          </InlineFieldRow>

          <FilterBuilder
            datasourceId={datasource.id}
            filters={filters}
            onFiltersChange={(next: any) => onChange({ ...query, filters: next })}
            groupBy={query.groupBy ?? []}
            onGroupByChange={(gb: any) => onChange({ ...query, groupBy: gb })}
            aggregation={query.aggregation}
            onAggregationChange={(agg: any) => onChange({ ...query, aggregation: agg })}
            onAggregationDelete={() => onChange({ ...query, aggregation: undefined })}
            valueAs={query.valueAs}
            onValueAsChange={(v: any) => onChange({ ...query, valueAs: v })}
            onValueAsDelete={() => onChange({ ...query, valueAs: undefined })}
            startTime={effectiveTimeRange.startTime}
            endTime={effectiveTimeRange.endTime}
            mode="metrics"
            metricName={query.metricName}
            metricType={query.metricType}
            metricAggregation={query.aggregation}
            onMetricAggregationChange={(agg: any) => onChange({ ...query, aggregation: agg })}
            onMetricAggregationDelete={() => onChange({ ...query, aggregation: undefined })}
            metricValueAs={query.valueAs}
            onMetricValueAsChange={(v: any) => onChange({ ...query, valueAs: v })}
            onMetricValueAsDelete={() => onChange({ ...query, valueAs: undefined })}
          />

          <InlineFieldRow style={{ marginTop: 8, alignItems: 'center' }}>
            <InlineField label="Only show series where max value" tooltip="Filter to only show series where the maximum value meets this condition.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  value={query.valueThreshold?.enabled ?? false}
                  onChange={(e) => {
                    const enabled = e.currentTarget.checked;
                    onChange({
                      ...query,
                      valueThreshold: {
                        enabled,
                        operator: query.valueThreshold?.operator ?? '>',
                        value: query.valueThreshold?.value ?? 0,
                      },
                    });
                  }}
                />
                {query.valueThreshold?.enabled && (
                  <>
                    <Combobox
                      options={VALUE_THRESHOLD_OPTIONS}
                      value={query.valueThreshold?.operator ?? '>'}
                      onChange={(opt) => {
                        onChange({
                          ...query,
                          valueThreshold: {
                            ...query.valueThreshold!,
                            operator: (opt?.value as ValueThresholdOperator) ?? '>',
                          },
                        });
                      }}
                      width={8}
                    />
                    <Input
                      type="number"
                      value={query.valueThreshold?.value ?? 0}
                      onChange={(e) => {
                        const val = parseFloat(e.currentTarget.value);
                        onChange({
                          ...query,
                          valueThreshold: {
                            ...query.valueThreshold!,
                            value: Number.isFinite(val) ? val : 0,
                          },
                        });
                      }}
                      width={12}
                    />
                  </>
                )}
              </div>
            </InlineField>
          </InlineFieldRow>

          {!!promqlPreview && (
            <div style={{ marginTop: 8 }}>
              <PrismPromQLEditor value={promqlPreview} language="promql" height={40} width="100%" wordWrap />
            </div>
          )}
        </>
      )}

      {subTab === 'code' && (
        <div>
          <InlineFieldRow>
            <PrismPromQLEditor
              value={codeDraft}
              language="promql"
              height={40}
              width="100%"
              wordWrap
              onChange={(val: any) => {
                const next = val ?? '';
                setCodeDraft(next);
                onChange({ ...query, promqlSubTab: 'code', promqlOutput: next, promqlEdited: true });
              }}
              onBlur={() => {
                if ((query.promqlOutput ?? '') !== codeDraft) {
                  onChange({
                    ...query,
                    promqlSubTab: 'code',
                    promqlOutput: codeDraft,
                    promqlEdited: true,
                  });
                }
              }}
            />
          </InlineFieldRow>
        </div>
      )}
    </div>
  );
}

export default MetricsTab;
