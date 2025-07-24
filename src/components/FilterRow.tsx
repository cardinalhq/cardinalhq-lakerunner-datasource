import React from 'react';
import { InlineFieldRow, InlineField, Combobox, IconButton, Button, Input } from '@grafana/ui';
import { Filter, Operator, OPERATOR_OPTIONS, TEXT_OPERATORS } from '../types';
import { useLabelValues } from '../hooks/useValues';
import type { DataSource } from 'datasource';

interface FilterRowProps {
  datasource: DataSource;
  index: number;
  startTime?: number;
  endTime?: number;
  filter: Filter;
  filters: Filter[];
  labels: string[];
  loadingLabels: boolean;
  updateFilter: (index: number, patch: Partial<Filter>) => void;
  removeFilter: (index: number) => void;
  addFilter: () => void;
  onRunQuery: () => void;
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
}

export const FilterRow = ({
  datasource,
  index,
  startTime,
  endTime,
  filter,
  filters,
  labels,
  loadingLabels,
  updateFilter,
  removeFilter,
  addFilter,
  onRunQuery,
  metricType,
  mode = 'logs',
  metricName,
}: FilterRowProps) => {
  const isMetricsMode = mode === 'metrics';
  const isLast = index === filters.length - 1;

  const isTextOperator = TEXT_OPERATORS.includes(filter.op);

  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    datasource,
    labelName: filter.tag,
    filters: filters.slice(0, index),
    enabled: !!filter.tag && (!isMetricsMode || !!metricName),
    mode,
    metricName,
    metricType,
    startTime,
    endTime,
  });

  const tagOptions = loadingLabels
    ? [{ label: 'Loading...', value: '__loading' }]
    : labels
        .filter((l: string) => l !== '_cardinalhq.name')
        .map((l: string) => ({ label: l, value: l }))
        .sort((a, b) => a.label.localeCompare(b.label));

  const valueOptions = loadingValues
    ? [{ label: 'Loading...', value: '__loading' }]
    : values.map((v: string) => ({ label: v, value: v })).sort((a, b) => a.label.localeCompare(b.label));

  return (
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
              op: isMessage ? 'contains' : filter.op ?? '=',
              value: [''],
            });
          }}
          placeholder="Select label"
          disabled={loadingLabels}
          loading={loadingLabels}
        />
      </InlineField>

      <InlineField>
        <Combobox
          width={10}
          options={OPERATOR_OPTIONS}
          value={filter.op}
          onChange={(v) => {
            updateFilter(index, { op: v?.value as Operator, value: [''] });
          }}
          placeholder="Op"
          disabled={!filter.tag}
        />
      </InlineField>

      <InlineField>
        {isTextOperator ? (
          <Input
            value={filter.value?.[0] ?? ''}
            onChange={(e) => updateFilter(index, { value: [e.currentTarget.value] })}
            width={30}
            placeholder="Enter value"
            disabled={!filter.tag}
          />
        ) : (
          <InlineField>
            <div style={!filter.tag ? { pointerEvents: 'none', opacity: 0.5 } : {}}>
              <Combobox
                options={valueOptions}
                value={filter.value?.[0]}
                onChange={(v) => {
                  if (v?.value !== '__loading') {
                    updateFilter(index, { value: [v?.value ?? ''] });
                  }
                }}
                placeholder="Select value"
                loading={loadingValues}
              />
            </div>
          </InlineField>
        )}
      </InlineField>

      <InlineField>
        <IconButton
          name="trash-alt"
          title="Remove filter"
          aria-label="Remove filter"
          onClick={() => removeFilter(index)}
        />
      </InlineField>

      {isLast && (
        <InlineField>
          <Button icon="plus" variant="secondary" onClick={addFilter} />
        </InlineField>
      )}
    </InlineFieldRow>
  );
};
