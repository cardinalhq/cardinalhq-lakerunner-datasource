import { Button, Combobox, IconButton, InlineField, InlineFieldRow, Input, Select } from '@grafana/ui';
import type { DataSource } from 'datasource';
import React, { useMemo } from 'react';
import { useLabels } from '../hooks/useLabels';
import { useLabelValues } from '../hooks/useValues';
import {
  AGGREGATE_OPTIONS,
  Aggregation,
  Filter,
  Operator,
  OPERATOR_OPTIONS,
  TEXT_OPERATORS,
  NUMERIC_OPERATORS,
  ValueAs,
} from '../types';
import { toInternalLabel } from 'services/logs';

interface FilterRowProps {
  datasource: DataSource;
  index: number;
  startTime?: number;
  endTime?: number;
  filter: Filter;
  filters: Filter[];
  updateFilter: (index: number, patch: Partial<Filter>) => void;
  removeFilter: (index: number) => void;
  addFilter: () => void;
  updateGroupBy: (labels: string[]) => void;
  groupBy: string[];
  onRunQuery: () => void;
  mode?: 'logs' | 'metrics' | 'promQL' | 'traces';
  metricName?: string;
  metricType?: string;
  aggregation?: string;
  updateAggregation: (aggregation: Aggregation) => void;
  setIsWaiting?: (isWaiting: boolean) => void;
  extract?: { regex: string; fields: string[]; selections?: Array<{ dataType: 'string' | 'number' }> };
  labelsRefreshKey?: number;
  valueAs?: ValueAs;
  updateValueAs?: (v: ValueAs) => void;
  fingerprint?: string;
}

export const FilterRow = ({
  datasource,
  index,
  startTime,
  endTime,
  filter,
  filters,
  updateFilter,
  removeFilter,
  addFilter,
  updateGroupBy,
  groupBy,
  onRunQuery,
  metricType,
  mode = 'logs',
  metricName,
  aggregation,
  updateAggregation,
  setIsWaiting,
  extract,
  labelsRefreshKey = 0,
  valueAs,
  updateValueAs,
  fingerprint,
}: FilterRowProps) => {
  const normalizedExtract = extract
    ? {
        regex: extract.regex,
        fields: extract.fields.map((name, i) => ({
          name,
          type: extract.selections?.[i]?.dataType ?? 'string',
        })),
      }
    : undefined;
  const isDurationTag = !!filter.tag && filter.tag.toLowerCase().includes('duration');

  const isNumericTag =
    !!filter.tag &&
    (normalizedExtract?.fields?.some((f) => f.name === filter.tag && f.type === 'number') || isDurationTag);

  const isMetricsMode = mode === 'metrics' || mode === 'promQL';
  const isTracesMode = mode === 'traces';
  const isLast = index === filters.length - 1;
  const operatorOptions = isNumericTag
    ? NUMERIC_OPERATORS.map((op) => ({ label: op, value: op as Operator }))
    : OPERATOR_OPTIONS;

  const isTextOperator = !isNumericTag && TEXT_OPERATORS.includes(filter.op);
  const isMultiValueOperator = !isNumericTag && (filter.op === 'in' || filter.op === 'not_in');
  const systemFilters = useMemo<Filter[]>(() => {
    const arr: Filter[] = [];
    if (fingerprint && fingerprint.trim()) {
      arr.push({
        tag: '_cardinalhq.fingerprint',
        op: 'eq',
        value: [fingerprint],
        dataType: 'string',
        extracted: false,
        computed: false,
      } as unknown as Filter);
    }
    return arr;
  }, [fingerprint]);
  const scopedFilters = useMemo(() => {
    const isValid = (f: Filter) => !!f.tag?.trim() && Array.isArray(f.value) && f.value.some((v) => !!v?.trim());
    const currentInternal = toInternalLabel(filter.tag || '');
    return (filters ?? [])
      .filter((_, i) => i !== index)
      .filter(isValid)
      .filter((f) => toInternalLabel(f.tag || '') !== currentInternal);
  }, [filters, index, filter.tag]);

  const effectiveFilters = useMemo<Filter[]>(() => {
    const seen = new Set(scopedFilters.map((f) => toInternalLabel(f.tag || '')));
    const extras = systemFilters.filter((f) => !seen.has(toInternalLabel(f.tag || '')));
    return [...scopedFilters, ...extras];
  }, [scopedFilters, systemFilters]);
  const shouldRunValues = !!filter.tag?.trim() && (!isMetricsMode || !!metricName) && !isNumericTag;

  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    datasource,
    labelName: filter.tag,
    filters: effectiveFilters,
    enabled: shouldRunValues,
    mode,
    metricName,
    metricType,
    startTime,
    endTime,
    setIsWaiting,
    extract: normalizedExtract,
  });
  const { data: groupByLabels = [], isLoading: loadingGroupByLabels } = useLabels({
    datasource,
    filters: effectiveFilters,
    enabled: !isMetricsMode || !!metricName,
    mode,
    startTime,
    endTime,
    metricName,
    metricType,
    setIsWaiting,
    extract: normalizedExtract,
    refreshKey: labelsRefreshKey,
  });

  const tagOptionsBase =
    loadingGroupByLabels || groupByLabels.length === 0
      ? [{ label: 'Loading...', value: '__loading' }]
      : groupByLabels
          .filter((l: string) => l !== '_cardinalhq.name')
          .map((l: string) => ({ label: l, value: l }))
          .sort((a, b) => a.label.localeCompare(b.label));

  const tagOptions =
    filter.tag && !tagOptionsBase.some((o) => o.value === filter.tag)
      ? [...tagOptionsBase, { label: filter.tag, value: filter.tag }]
      : tagOptionsBase;

  const valueOptionsBase = loadingValues
    ? [{ label: 'Loading...', value: '__loading' }]
    : values.length === 0
    ? [{ label: 'No values', value: '__none' }]
    : values.map((v: string) => ({ label: v, value: v })).sort((a, b) => a.label.localeCompare(b.label));

  const valueOptions = filter.value
    ? [
        ...valueOptionsBase,
        ...filter.value
          .filter((val) => !valueOptionsBase.some((o) => o.value === val))
          .map((val) => ({ label: val, value: val })),
      ]
    : valueOptionsBase;

  const groupByOptions = groupBy.length
    ? [
        ...tagOptionsBase,
        ...groupBy.filter((g) => !tagOptionsBase.some((o) => o.value === g)).map((g) => ({ label: g, value: g })),
      ]
    : tagOptionsBase;

  const aggOptions = useMemo(() => {
    if (isMetricsMode && metricType === 'count') {
      return AGGREGATE_OPTIONS.filter((opt) => opt.value === 'sum');
    }
    if (!isMetricsMode) {
      return AGGREGATE_OPTIONS.filter((opt) => opt.value === 'sum');
    }
    return AGGREGATE_OPTIONS;
  }, [isMetricsMode, metricType]);

  const valueAsOptions = useMemo(() => {
    if (!isMetricsMode) {
      return [];
    }
    if (metricType === 'count') {
      return [
        { label: 'Counts', value: 'counts' as const },
        { label: 'Rates / second', value: 'rates_per_second' as const },
      ];
    }
    return [{ label: 'Values', value: 'values' as const }];
  }, [isMetricsMode, metricType]);

  return (
    <>
      <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
        <InlineField>
          <Select
            options={tagOptions}
            value={filter.tag ? { label: filter.tag, value: filter.tag } : null}
            createCustomValue
            onChange={(v) => {
              const selected = v?.value ?? '';
              if (selected === '__loading') {
                return;
              }

              const isMessage = selected === 'message';
              const nextIsDuration = selected.toLowerCase().includes('duration');
              const nextIsNumeric =
                nextIsDuration || !!normalizedExtract?.fields?.some((f) => f.name === selected && f.type === 'number');

              updateFilter(index, {
                tag: selected,
                op: nextIsNumeric ? '=' : isMessage ? 'contains' : '=',
                value: [''],
                dataType: nextIsNumeric ? 'number' : 'string',
              });
            }}
            placeholder="Select a tag"
            loading={loadingGroupByLabels}
          />
        </InlineField>

        <InlineField>
          <Combobox
            width={10}
            options={operatorOptions}
            value={filter.op}
            onChange={(v) => {
              const selectedOp = v?.value as Operator;
              updateFilter(index, { op: selectedOp, value: [''] });
            }}
            disabled={!filter.tag}
          />
        </InlineField>

        <InlineField>
          {isNumericTag ? (
            <Input
              type="number"
              step="any"
              value={filter.value?.[0] ?? ''}
              onChange={(e) => updateFilter(index, { value: [e.currentTarget.value] })}
              width={20}
              placeholder="Enter number"
              disabled={!filter.tag}
            />
          ) : isTextOperator ? (
            <Input
              value={filter.value?.[0] ?? ''}
              onChange={(e) => updateFilter(index, { value: [e.currentTarget.value] })}
              width={30}
              placeholder="Enter value"
              disabled={!filter.tag}
            />
          ) : isMultiValueOperator ? (
            <div style={!filter.tag ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
              <Select
                options={valueOptions}
                value={filter.value?.map((v) => ({ label: v, value: v })) ?? []}
                allowCustomValue
                isMulti
                onChange={(v) => {
                  const selectedValues = v
                    .map((item: { value: string }) => item.value)
                    .filter((val: string) => !!val && val !== '__loading' && val !== '__none');
                  updateFilter(index, { value: selectedValues });
                }}
                placeholder="Select values"
                isLoading={loadingValues}
              />
            </div>
          ) : (
            <div style={!filter.tag ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
              <Select
                options={valueOptions}
                value={filter.value?.[0] ? { label: filter.value[0], value: filter.value[0] } : null}
                createCustomValue
                onChange={(v) => {
                  const val = v?.value ?? '';
                  if (val !== '__loading' && val !== '__none') {
                    updateFilter(index, { value: [val] });
                  }
                }}
                placeholder="Value"
                loading={loadingValues}
              />
            </div>
          )}
        </InlineField>

        <InlineField>
          <IconButton
            name="trash-alt"
            title="Remove filter"
            aria-label="Remove filter"
            onClick={() => removeFilter(index)}
            style={{ marginTop: 6 }}
          />
        </InlineField>

        {isLast && (
          <InlineField>
            <Button icon="plus" variant="secondary" onClick={addFilter} />
          </InlineField>
        )}
      </InlineFieldRow>

      {isLast && !isTracesMode && (
        <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
          <InlineField label="Group by">
            <Select
              placeholder="Select tags"
              options={groupByOptions}
              value={groupBy.map((g) => ({ label: g, value: g }))}
              allowCustomValue
              isMulti
              onChange={(v) => {
                const selected = v
                  .map((item: { value: string }) => item.value)
                  .filter((val: string) => Boolean(val && val !== '__loading'));
                updateGroupBy(selected);
              }}
            />
          </InlineField>

          <InlineField label="Aggregation">
            <Combobox
              placeholder="Aggregation"
              options={aggOptions}
              value={aggregation}
              onChange={(v) => updateAggregation((v?.value ?? '') as Aggregation)}
            />
          </InlineField>
          {isMetricsMode && (
            <InlineField label="Value as" style={{ marginLeft: 8 }}>
              <Select
                placeholder="Select"
                options={valueAsOptions}
                value={
                  valueAs
                    ? {
                        label: valueAsOptions.find((o) => o.value === valueAs)?.label ?? '',
                        value: valueAs,
                      }
                    : null
                }
                onChange={(v) => {
                  const next = (v?.value as ValueAs) ?? ((metricType === 'count' ? 'counts' : 'values') as ValueAs);
                  updateValueAs?.(next);
                }}
                width={20}
              />
            </InlineField>
          )}
        </InlineFieldRow>
      )}
    </>
  );
};
