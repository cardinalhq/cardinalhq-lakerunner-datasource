import React from 'react';
import {
  Button,
  MultiSelect,
  InlineFieldRow,
} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import {
  MyDataSourceOptions,
  MyQuery,
  Filter,
  Operator,
} from '../types';
import { useLogLabels } from '../hooks/useLabels';
import { FilterRow } from './FilterRow';

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const filters: Filter[] = query.filters ?? [];

  const { data: labels = [], isLoading: loadingLabels } = useLogLabels({
    enabled: true,
    filters,
  });

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const addFilter = () => {
    const defaultTag = labels[0] ?? '';
    const updated = [
      ...filters,
      { tag: defaultTag, op: '=' as Operator, value: [''] },
    ];
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const removeFilter = (index: number) => {
    const updated = [...filters];
    updated.splice(index, 1);
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  return (
    <div>
      {filters.map((filter, index) => (
        <FilterRow
          key={index}
          index={index}
          filter={filter}
          filters={filters}
          labels={labels}
          loadingLabels={loadingLabels}
          updateFilter={updateFilter}
          removeFilter={removeFilter}
          onRunQuery={onRunQuery}
        />
      ))}

      <InlineFieldRow style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <div>
          <MultiSelect
            placeholder="Group by"
            options={labels.map((l) => ({ label: l, value: l }))}
            value={query.groupBy ?? []}
            onChange={(v) => {
              const selected = v.map((item) => item.value).filter((val): val is string => Boolean(val));
              onChange({
                ...query,
                groupBy: selected,
              });
              onRunQuery();
            }}
          />
        </div>
        <Button
          icon="plus"
          variant="secondary"
          onClick={addFilter}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Add Filter
        </Button>
      </InlineFieldRow>
      </div>
  );
}
