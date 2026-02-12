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
import { InlineField, InlineFieldRow, Button, IconButton, Combobox, MultiCombobox, Input } from '@grafana/ui';
import {
  OPERATOR_OPTIONS,
  Operator,
  Filter,
  Aggregation,
  TEXT_OPERATORS,
  VALUE_AS_OPTIONS,
  ValueAs,
  AGGREGATE_OPTIONS,
  MyQuery,
} from '../types';
import { useTagValues } from '../hooks/useTagValues';
import { buildLogQLExpressions } from '../util/LogqlBuilder';
import { withHiddenFingerprint } from '../util/buildFinalLogQL';
import { promqlFromQueryBuilder } from '../util/MetricsBuilder';
import { toUserLabel } from '../services/tags';

const MESSAGE_TAG = 'log_message';
const METRIC_NAME_TAG = '_cardinalhq_name';
const DURATION_TAG = 'span_duration';
const VALUE_AS_OPTIONS_LOGS_BASE = VALUE_AS_OPTIONS.filter((o) => o.value !== 'values' && o.value !== 'counts');
type Mode = 'logs' | 'metrics' | 'traces';

export function FilterRow(props: {
  datasourceId: number;
  index: number;
  filter: Filter;
  filters: Filter[];
  onUpdate: (index: number, patch: Partial<Filter>) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  tags: string[];
  loadingTags: boolean;
  groupBy: string[];
  onGroupByChange: (gb: string[]) => void;
  aggregation?: Aggregation;
  onAggregationChange: (agg: Aggregation | undefined) => void;
  onAggregationDelete?: () => void;
  valueAs?: ValueAs | string;
  onValueAsChange: (v: ValueAs | string | undefined) => void;
  onValueAsDelete?: () => void;
  startTime?: number;
  endTime?: number;
  selectedFingerprint?: string;
  isLast: boolean;
  mode?: Mode;
  metricName?: string;
  metricType?: 'gauge' | 'histogram' | 'count' | undefined;
  metricAggregation?: Aggregation;
  onMetricAggregationChange?: (agg: Aggregation | undefined) => void;
  onMetricAggregationDelete?: () => void;
  metricValueAs?: ValueAs;
  onMetricValueAsChange?: (v: ValueAs | undefined) => void;
  onMetricValueAsDelete?: () => void;
  fields?: string[];
  onFieldsChange?: (fields: string[]) => void;
}) {
  const {
    datasourceId,
    index,
    filter,
    filters,
    onUpdate,
    onRemove,
    onAdd,
    tags,
    loadingTags,
    groupBy,
    onGroupByChange,
    aggregation,
    onAggregationChange,
    onAggregationDelete,
    valueAs,
    onValueAsChange,
    onValueAsDelete,
    startTime,
    endTime,
    selectedFingerprint,
    isLast,
    mode = 'logs',
    metricName,
    metricType,
    metricAggregation,
    onMetricAggregationChange,
    onMetricAggregationDelete,
    metricValueAs,
    onMetricValueAsChange,
    onMetricValueAsDelete,
  } = props;

  const isLogs = mode === 'logs';
  const isMetrics = mode === 'metrics';
  const isTraces = mode === 'traces';
  const isLogsLike = isLogs || isTraces;

  const isDurationTag = filter.tag === DURATION_TAG || filter.tag === 'span_duration';
  const isNumericTag = !!filter.tag && isDurationTag;
  const isMessageTag = isLogs && filter.tag === MESSAGE_TAG;
  const isTextOperator = TEXT_OPERATORS.includes(filter.op);
  const isMultiValueOperator = filter.op === 'in' || filter.op === 'not_in';

  const tagKeysEnabled = isLogsLike || (isMetrics && !!metricName);

  const prevTagRef = useRef<string | undefined>(filter.tag);
  useEffect(() => {
    if (filter.tag === MESSAGE_TAG && prevTagRef.current !== MESSAGE_TAG) {
      onUpdate(index, { op: 'contains' as Operator });
    }
    prevTagRef.current = filter.tag;
  }, [filter.tag, index, onUpdate]);

  const prevMetricTypeRef = useRef<typeof metricType>(metricType);
  const prevMetricNameRef = useRef<typeof metricName>(metricName);

  useEffect(() => {
    if (!isMetrics || !metricType || !metricName) {
      return;
    }
    const typeChanged = prevMetricTypeRef.current !== metricType;
    const nameChanged = prevMetricNameRef.current !== metricName;
    const shouldSetDefaults = typeChanged || nameChanged;
    if (metricType === 'count') {
      if (shouldSetDefaults || !metricAggregation) {
        onMetricAggregationChange?.('sum');
      }
      if (shouldSetDefaults || !metricValueAs) {
        onMetricValueAsChange?.('rates_per_second');
      }
    } else if (metricType === 'gauge' || metricType === 'histogram') {
      if (shouldSetDefaults || !metricAggregation) {
        onMetricAggregationChange?.('max');
      }
      if (shouldSetDefaults || !metricValueAs) {
        onMetricValueAsChange?.('values');
      }
    }
    if (typeChanged) {
      prevMetricTypeRef.current = metricType;
    }
    if (nameChanged) {
      prevMetricNameRef.current = metricName;
    }
  }, [
    isMetrics,
    metricType,
    metricName,
    metricAggregation,
    metricValueAs,
    onMetricAggregationChange,
    onMetricValueAsChange,
  ]);

  const comparisonOps: Array<{ label: string; value: Operator }> = [
    { label: '=', value: '=' },
    { label: '!=', value: '!=' },
    { label: '<', value: '<' as Operator },
    { label: '<=', value: '<=' as Operator },
    { label: '>', value: '>' as Operator },
    { label: '>=', value: '>=' as Operator },
  ];

  const operatorOptions = isMessageTag
    ? OPERATOR_OPTIONS.filter((o) => (TEXT_OPERATORS as Operator[]).includes(o.value as Operator))
    : isNumericTag
    ? comparisonOps
    : OPERATOR_OPTIONS;

  const enableTagValues =
    !!filter.tag && !isMessageTag && !isTextOperator && !isNumericTag && (!isMetrics || !!metricName);

  const scopeExpr = useMemo(() => {
    if (!enableTagValues) {
      return undefined;
    }
    if (isLogsLike) {
      const otherFiltersStable: Filter[] = filters
        .filter((_, i) => i !== index)
        .filter((f) => f.tag !== MESSAGE_TAG && !TEXT_OPERATORS.includes(f.op));
      const { filtersExpr } = buildLogQLExpressions(
        { filters: otherFiltersStable, valueAs: undefined, logqlAggregation: undefined, groupBy: [] }, // extractor removed
        '5m'
      );
      let expr = filtersExpr || '{}';
      if (selectedFingerprint) {
        expr = withHiddenFingerprint(expr, selectedFingerprint);
      }
      return expr && expr !== '{}' ? expr : undefined;
    }
    if (isMetrics && metricName) {
      const otherFiltersStable: Filter[] = filters.filter((_, i) => i !== index);
      const fakeQuery: MyQuery = {
        refId: 'A',
        datasource: null as any,
        metricName,
        metricType,
        filters: otherFiltersStable,
        groupBy,
        aggregation: metricAggregation,
        valueAs: metricValueAs,
        aggregationManuallyDeleted: false,
      };
      const expr = promqlFromQueryBuilder(fakeQuery);
      return expr || undefined;
    }
    return undefined;
  }, [
    enableTagValues,
    isLogsLike,
    isMetrics,
    metricName,
    filters,
    selectedFingerprint,
    index,
    metricType,
    groupBy,
    metricAggregation,
    metricValueAs,
  ]);

  const tagOptions = (isMetrics ? tags.filter((t) => t !== MESSAGE_TAG && t !== METRIC_NAME_TAG) : tags).map((t) => ({
    label: toUserLabel(t),
    value: t,
  }));

  const { values: tagValues, loading: loadingValues } = useTagValues({
    enabled: enableTagValues,
    datasourceId,
    tagName: filter.tag,
    expr: scopeExpr,
    startTime,
    endTime,
    mode: isMetrics ? 'metrics' : isTraces ? 'traces' : 'logs',
  });

  const aggOptionsMetrics = useMemo(() => AGGREGATE_OPTIONS, []);
  const currentAgg = isMetrics ? metricAggregation : aggregation;
  const currentValueAs = isMetrics ? metricValueAs : valueAs;

  const aggDeletedRef = useRef(false);
  const valueAsDeletedRef = useRef(false);

  const handleAggChange = (val: Aggregation | undefined) => {
    aggDeletedRef.current = false;
    if (isMetrics) {
      onMetricAggregationChange?.(val);
    } else {
      onAggregationChange(val);
    }
  };
  const handleAggDelete = () => {
    aggDeletedRef.current = true;
    if (isMetrics) {
      onMetricAggregationDelete?.();
    } else {
      onAggregationDelete?.();
    }
  };
  const handleValueAsChange = (val: ValueAs | string | undefined) => {
    valueAsDeletedRef.current = false;
    if (isMetrics) {
      onMetricValueAsChange?.(val as ValueAs | undefined);
    } else {
      onValueAsChange(val);
    }
  };
  const handleValueAsDelete = () => {
    valueAsDeletedRef.current = true;
    if (isMetrics) {
      onMetricValueAsDelete?.();
    } else {
      onValueAsDelete?.();
    }
  };

  useEffect(() => {
    if (!(isLogs || isTraces)) {
      return;
    }
    if (
      (aggregation === 'sum' || aggregation === 'min' || aggregation === 'max') &&
      !valueAs &&
      !valueAsDeletedRef.current
    ) {
      onValueAsChange?.('rates_per_second');
    }
  }, [isLogs, isTraces, aggregation, valueAs, onValueAsChange]);

  useEffect(() => {
    if (!(isLogs || isTraces)) {
      return;
    }
    if (groupBy.length > 0) {
      if (!aggregation && !aggDeletedRef.current) {
        onAggregationChange?.('sum');
      }
      if (!valueAs && !valueAsDeletedRef.current) {
        onValueAsChange?.('rates_per_second');
      }
    }
  }, [isLogs, isTraces, groupBy, aggregation, valueAs, onAggregationChange, onValueAsChange]);

  const valueAsOptionsLogs = VALUE_AS_OPTIONS_LOGS_BASE;

  const [durationUnit, setDurationUnit] = useState<'ms' | 's' | 'm'>('ms');
  const [durationDisplay, setDurationDisplay] = useState<string>('');

  useEffect(() => {
    if (!isDurationTag) {
      return;
    }
    const raw = String(filter.value?.[0] ?? '').trim();
    const n = Number(raw);
    if (!isFinite(n) || n < 0) {
      setDurationDisplay('');
      return;
    }
    const div = durationUnit === 'ms' ? 1 : durationUnit === 's' ? 1000 : 60000;
    const v = n / div;
    setDurationDisplay(v === Math.trunc(v) ? String(v) : String(v));
  }, [isDurationTag, filter.value, durationUnit]);

  const applyDuration = (val: string, unit: 'ms' | 's' | 'm') => {
    const n = Number(val);
    if (!isFinite(n) || n < 0) {
      onUpdate(index, { value: [''] });
      return;
    }
    const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60000;
    onUpdate(index, { value: [String(ms)] });
  };

  return (
    <>
      <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
        <InlineField>
          <Combobox
            options={tagOptions}
            value={filter.tag ?? null}
            onChange={(v) => {
              const nextTag = v?.value ?? '';
              if (isLogs && nextTag === 'log_message') {
                onUpdate(index, { tag: nextTag, op: 'contains' as Operator, value: [''] });
              } else {
                onUpdate(index, { tag: nextTag });
              }
            }}
            placeholder={isMetrics && !metricName ? 'Select metric first' : 'Select tag'}
            loading={loadingTags}
            createCustomValue
            disabled={!tagKeysEnabled}
          />
        </InlineField>

        <InlineField>
          <Combobox
            width={10}
            options={operatorOptions}
            value={filter.op}
            onChange={(v) => {
              const nextOp = v?.value as Operator;
              const nextVal =
                nextOp === 'in' || nextOp === 'not_in'
                  ? Array.isArray(filter.value)
                    ? filter.value.filter(Boolean)
                    : []
                  : Array.isArray(filter.value)
                    ? [filter.value[0] ?? '']
                    : [''];
              onUpdate(index, { op: nextOp, value: nextVal });
            }}
            disabled={!filter.tag}
          />
        </InlineField>
        <InlineField>
          {isMessageTag ? (
            <Input
              value={filter.value?.[0] ?? ''}
              onChange={(e) => onUpdate(index, { value: [e.currentTarget.value] })}
              width={30}
              placeholder="Enter text"
              disabled={!filter.tag}
            />
          ) : isDurationTag ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Input
                type="text"
                value={durationDisplay}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setDurationDisplay(v);
                  applyDuration(v, durationUnit);
                }}
                width={20}
                placeholder="Enter duration"
                disabled={!filter.tag}
              />
              <Combobox
                width={10}
                options={[
                  { label: 'ms', value: 'ms' },
                  { label: 'sec', value: 's' },
                  { label: 'min', value: 'm' },
                ]}
                value={durationUnit}
                onChange={(v) => {
                  const u = (v?.value as 'ms' | 's' | 'm') ?? 'ms';
                  setDurationUnit(u);
                  applyDuration(durationDisplay, u);
                }}
              />
            </div>
          ) : isNumericTag ? (
            <Input
              type="text"
              value={filter.value?.[0] ?? ''}
              onChange={(e) => onUpdate(index, { value: [e.currentTarget.value] })}
              width={20}
              placeholder="Enter number"
              disabled={!filter.tag}
            />
          ) : isMultiValueOperator ? (
            <MultiCombobox
              options={
                loadingValues && !tagValues.length
                  ? [{ label: 'Loading...', value: '__loading' }]
                  : tagValues.map((v) => ({ label: v, value: v }))
              }
              value={(filter.value ?? []).filter((v) => v && v !== '__loading')}
              createCustomValue
              onChange={(v) => {
                const selectedValues = v
                  .map((item: { value: string }) => item.value)
                  .filter((val: string) => val && val !== '__loading');
                onUpdate(index, { value: selectedValues });
              }}
              placeholder={loadingValues ? 'Loading…' : 'Select values'}
              disabled={!filter.tag}
              loading={loadingValues}
            />
          ) : TEXT_OPERATORS.includes(filter.op) ? (
            <Input
              value={filter.value?.[0] ?? ''}
              onChange={(e) => onUpdate(index, { value: [e.currentTarget.value] })}
              width={30}
              placeholder="Enter value"
              disabled={!filter.tag}
            />
          ) : (
            <Combobox
              options={
                loadingValues && !tagValues.length
                  ? [{ label: 'Loading...', value: '__loading' }]
                  : tagValues.map((v) => ({ label: v, value: v }))
              }
              value={filter.value?.[0] ?? null}
              createCustomValue
              onChange={(v) => {
                const val = v?.value ?? '';
                if (val !== '__none') {
                  onUpdate(index, { value: [val] });
                }
              }}
              placeholder={loadingValues ? 'Loading…' : 'Value'}
              disabled={!filter.tag}
              loading={loadingValues}
            />
          )}
        </InlineField>
        <InlineField>
          <IconButton
            name="trash-alt"
            title="Remove filter"
            aria-label="Remove filter"
            onClick={() => onRemove(index)}
            disabled={filters.length === 1}
          />
        </InlineField>
        {isLast && (
          <InlineField>
            <Button icon="plus" variant="secondary" onClick={onAdd} aria-label="Add filter" />
          </InlineField>
        )}
      </InlineFieldRow>

      {isLast && (
        <>
          <InlineFieldRow style={{ marginBottom: 4, gap: 8, alignItems: 'center' }}>
            {(isMetrics || isLogs || isTraces) && (
              <InlineField label="Aggregation">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Combobox
                    options={isMetrics ? aggOptionsMetrics : AGGREGATE_OPTIONS}
                    value={currentAgg ?? null}
                    onChange={(v) => handleAggChange(v?.value as Aggregation)}
                    placeholder="Select aggregation"
                  />
                  {currentAgg && (
                    <IconButton
                      name="trash-alt"
                      title="Clear aggregation"
                      aria-label="Clear aggregation"
                      onClick={handleAggDelete}
                      size="sm"
                    />
                  )}
                </div>
              </InlineField>
            )}

            {(isLogs || isTraces) && (
              <InlineField label="Value as">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Combobox
                    options={valueAsOptionsLogs}
                    value={currentValueAs ?? null}
                    onChange={(v) => handleValueAsChange(v?.value as ValueAs | string)}
                    placeholder="Select value type"
                  />
                  {currentValueAs && (
                    <IconButton
                      name="trash-alt"
                      title="Remove value as"
                      aria-label="Remove value as"
                      onClick={handleValueAsDelete}
                      size="sm"
                    />
                  )}
                </div>
              </InlineField>
            )}

            <InlineField label="Group by">
              <MultiCombobox
                placeholder={isMetrics && !metricName ? 'Select metric first' : 'Select tags'}
                options={tagOptions}
                value={groupBy ?? []}
                createCustomValue
                onChange={(selectedOptions) => {
                  const newGroupBy = Array.isArray(selectedOptions)
                    ? selectedOptions.map((item: { value: any }) => item.value)
                    : [];
                  onGroupByChange(newGroupBy);
                }}
                disabled={!tagKeysEnabled}
                width={30}
              />
            </InlineField>
          </InlineFieldRow>
        </>
      )}
    </>
  );
}
