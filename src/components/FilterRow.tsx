import React from 'react';
import { Combobox, IconButton } from '@grafana/ui';
import { Filter, Operator } from '../types';
import { useLabelValues } from '../hooks/useValues';

interface FilterRowProps {
  index: number;
  filter: Filter;
  filters: Filter[];
  labels: string[];
  loadingLabels: boolean;
  updateFilter: (index: number, patch: Partial<Filter>) => void;
  removeFilter: (index: number) => void;
  onRunQuery: () => void;
}

export const FilterRow = ({
  index,
  filter,
  filters,
  labels,
  loadingLabels,
  updateFilter,
  removeFilter,
  onRunQuery,
}: FilterRowProps) => {
  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    labelName: filter.tag,
    filters: filters.slice(0, index),
    enabled: !!filter.tag,
  });

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <Combobox
        options={
          loadingLabels
            ? [{ label: 'Loading...', value: '__loading' }]
            : labels.map((l: any) => ({ label: l, value: l }))
        }
        value={filter.tag}
        onChange={(v) => {
          const selected = v?.value ?? '';
          updateFilter(index, { tag: selected, value: [''] });
          onRunQuery();
        }}
        placeholder="Tag"
        loading={loadingLabels}
        width={20}
      />
      <Combobox
        options={[
          { label: '=', value: '=' },
          { label: '!=', value: '!=' },
          { label: 'in', value: 'in' },
          { label: 'not in', value: 'not_in' },
        ]}
        value={filter.op}
        onChange={(v) => {
          updateFilter(index, { op: v?.value as Operator });
          onRunQuery();
        }}
        placeholder="Operator"
        disabled={!filter.tag}
        width={10}
      />
      <Combobox
        options={
          loadingValues
            ? [{ label: 'Loading...', value: '__loading' }]
            : values.map((v: string) => ({ label: v, value: v }))
        }
        value={filter.value?.[0]}
        onChange={(v) => {
          if (v?.value !== '__loading') {
            updateFilter(index, { value: [v?.value ?? ''] });
            onRunQuery();
          }
        }}
        placeholder="Value"
        disabled={!filter.tag}
        loading={loadingValues}
        width={20}
      />
      <IconButton
        name="trash-alt"
        title="Remove filter"
        onClick={() => removeFilter(index)}
        variant="destructive"
        aria-label="Remove filter"
      />
    </div>
  );
};
