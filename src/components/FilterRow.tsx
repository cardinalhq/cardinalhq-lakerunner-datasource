import { Button, Combobox, IconButton, InlineField, InlineFieldRow, Input, Select } from '@grafana/ui';
import type { DataSource } from 'datasource';
import React, { useMemo } from 'react';
import { useLabels } from '../hooks/useLabels';
import { useLabelValues } from '../hooks/useValues';
import { AGGREGATE_OPTIONS, Aggregation, Filter, Operator, OPERATOR_OPTIONS, TEXT_OPERATORS } from '../types';

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
}: FilterRowProps) => {
  const isMetricsMode = mode === 'metrics';
  const isTracesMode = mode === 'traces';

  const isLast = index === filters.length - 1;
  const isTextOperator = TEXT_OPERATORS.includes(filter.op);
  const isMultiValueOperator = filter.op === 'in' || filter.op === 'not_in';
  const scopedFilters = useMemo(() => {
    const isValid = (f: Filter) => !!f.tag?.trim() && Array.isArray(f.value) && f.value.some((v) => !!v?.trim());
    return filters.slice(0, index).filter(isValid);
  }, [filters, index]);

  const shouldRunValues = !!filter.tag?.trim() && (!isMetricsMode || !!metricName);

  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    datasource,
    labelName: filter.tag,
    filters: scopedFilters,
    enabled: shouldRunValues,
    mode,
    metricName,
    metricType,
    startTime,
    endTime,
    setIsWaiting,
  });

  const { data: groupByLabels = [], isLoading: loadingGroupByLabels } = useLabels({
    datasource,
    filters: scopedFilters,
    enabled: !isMetricsMode || !!metricName,
    mode,
    startTime,
    endTime,
    metricName,
    metricType,
    setIsWaiting,
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

  return (
    <>
      <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
        {/* Tag */}
        <InlineField>
          <Select
            options={tagOptions}
            value={filter.tag ? { label: filter.tag, value: filter.tag } : null}
            allowCustomValue
            onChange={(v) => {
              const selected = v?.value ?? '';
              if (selected === '__loading') {
                return;
              }
              const isMessage = selected === 'message';
              updateFilter(index, {
                tag: selected,
                op: isMessage ? 'contains' : '=',
                value: [''],
              });
            }}
            placeholder="Select a tag"
            isLoading={loadingGroupByLabels}
          />
        </InlineField>

        {/* Operator */}
        <InlineField>
          <Combobox
            width={10}
            options={OPERATOR_OPTIONS}
            value={filter.op}
            onChange={(v) => {
              const selectedOp = v?.value as Operator;
              updateFilter(index, { op: selectedOp, value: [''] });
            }}
            disabled={!filter.tag}
          />
        </InlineField>

        {/* Value */}
        <InlineField>
          {isTextOperator ? (
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
                allowCustomValue
                onChange={(v) => {
                  const val = v?.value ?? '';
                  if (val !== '__loading' && val !== '__none') {
                    updateFilter(index, { value: [val] });
                  }
                }}
                placeholder="Value"
                isLoading={loadingValues}
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

      {/* Group By + Aggregation */}
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
              options={isMetricsMode ? AGGREGATE_OPTIONS : AGGREGATE_OPTIONS.filter((opt) => opt.value === 'sum')}
              value={aggregation}
              onChange={(v) => updateAggregation((v?.value ?? '') as Aggregation)}
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </>
  );
};
