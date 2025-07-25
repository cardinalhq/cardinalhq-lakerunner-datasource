import { Button, Combobox, IconButton, InlineField, InlineFieldRow, Input, MultiSelect } from '@grafana/ui';
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
  mode?: 'logs' | 'metrics';
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
  const isLast = index === filters.length - 1;
  const isTextOperator = TEXT_OPERATORS.includes(filter.op);

  const hasValidTagAndValue = !!filter.tag?.trim() && !!filter.value?.[0]?.trim();

  const scopedFilters = useMemo(() => {
    const prior = filters.slice(0, index);
    const current = hasValidTagAndValue ? [filter] : [];
    const full = [...prior, ...current];
    return full;
  }, [filters, filter, index, hasValidTagAndValue]);

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

  const tagOptions = groupByLabels
    .filter((l: string) => l !== '_cardinalhq.name')
    .map((l: string) => ({ label: l, value: l }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const valueOptions = loadingValues
    ? [{ label: 'Loading...', value: '__loading' }]
    : values.map((v: string) => ({ label: v, value: v })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
        <InlineField>
          <Combobox
            options={tagOptions}
            value={filter.tag}
            onChange={(v) => {
              const selected = v?.value ?? '';
              const isMessage = selected === 'message';
              updateFilter(index, {
                tag: selected,
                op: isMessage ? 'contains' : '=',
                value: [''],
              });
            }}
            placeholder="Tag name"
            disabled={loadingGroupByLabels}
            loading={loadingGroupByLabels}
          />
        </InlineField>

        <InlineField>
          <Combobox
            width={10}
            options={OPERATOR_OPTIONS}
            value={filter.op}
            onChange={(v) => {
              const selectedOp = v?.value as Operator;
              updateFilter(index, { op: selectedOp, value: [''] });
            }}
            placeholder="Op"
            disabled={!filter.tag}
          />
        </InlineField>

        <InlineField>
          {isTextOperator ? (
            <Input
              value={filter.value?.[0] ?? ''}
              onChange={(e) => {
                const val = e.currentTarget.value;
                updateFilter(index, { value: [val] });
              }}
              width={30}
              placeholder="Enter value"
              disabled={!filter.tag}
            />
          ) : (
            <div style={!filter.tag ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
              <Combobox
                options={valueOptions}
                value={filter.value?.[0] ?? ''}
                onChange={(v) => {
                  const val = v?.value ?? '';
                  if (val !== '__loading') {
                    updateFilter(index, { value: [val] });
                  }
                }}
                placeholder="value"
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
            onClick={() => {
              removeFilter(index);
            }}
          />
        </InlineField>

        {isLast && (
          <InlineField>
            <Button
              icon="plus"
              variant="secondary"
              onClick={() => {
                addFilter();
              }}
            />
          </InlineField>
        )}
      </InlineFieldRow>

      {isLast && (
        <InlineFieldRow style={{ marginBottom: 4, gap: 0, alignItems: 'center' }}>
          <InlineField label="Group by">
            <MultiSelect
              placeholder="Group by"
              options={tagOptions}
              value={groupBy}
              onChange={(v) => {
                const selected = v.map((item) => item.value).filter((val): val is string => Boolean(val));
                updateGroupBy(selected);
              }}
            />
          </InlineField>

          <InlineField label="Aggregation">
            <Combobox
              placeholder="Aggregation"
              options={isMetricsMode ? AGGREGATE_OPTIONS : AGGREGATE_OPTIONS.filter((opt) => opt.value === 'sum')}
              value={aggregation}
              onChange={(v) => {
                const selected = (v?.value ?? '') as Aggregation;
                updateAggregation(selected);
              }}
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </>
  );
};
