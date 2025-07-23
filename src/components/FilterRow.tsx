import React from 'react';
import { InlineFieldRow, InlineField, Combobox, IconButton, Button } from '@grafana/ui';
import { Filter, Operator } from '../types';
import { useLabelValues } from '../hooks/useValues';
import type { DataSource } from 'datasource';

interface FilterRowProps {
  datasource: DataSource;
  index: number;
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

  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    datasource,
    labelName: filter.tag,
    filters: filters.slice(0, index),
    enabled: !!filter.tag && (!isMetricsMode || !!metricName),
    mode,
    metricName,
    metricType,
  });

  const tagOptions = loadingLabels
    ? [{ label: 'Loading...', value: '__loading' }]
    : labels
        .filter((l: string) => l !== '_cardinalhq.name') // exclude internal tag
        .map((l: string) => ({ label: l, value: l }));

  return (
    <InlineFieldRow style={{ marginBottom: 4, gap: '4px', alignItems: 'center' }}>
      <InlineField>
        <Combobox
          width={20}
          options={tagOptions}
          value={filter.tag}
          onChange={(v) => {
            const selected = v?.value ?? '';
            updateFilter(index, { tag: selected, value: [''] });
            // onRunQuery();
          }}
          placeholder="Select label"
          disabled={loadingLabels}
          loading={loadingLabels}
        />
      </InlineField>

      <InlineField>
        <Combobox
          width={8}
          options={[
            { label: '=', value: '=' },
            { label: '!=', value: '!=' },
            { label: 'in', value: 'in' },
            { label: 'not in', value: 'not_in' },
          ]}
          value={filter.op}
          onChange={(v) => {
            updateFilter(index, { op: v?.value as Operator });
            // onRunQuery();
          }}
          placeholder="Op"
          disabled={!filter.tag}
        />
      </InlineField>

      <InlineField>
        <Combobox
          width={20}
          options={
            loadingValues
              ? [{ label: 'Loading...', value: '__loading' }]
              : values.map((v: string) => ({ label: v, value: v }))
          }
          value={filter.value?.[0]}
          onChange={(v) => {
            if (v?.value !== '__loading') {
              updateFilter(index, { value: [v?.value ?? ''] });
              // onRunQuery();
            }
          }}
          placeholder="Select value"
          disabled={!filter.tag}
          loading={loadingValues}
        />
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
