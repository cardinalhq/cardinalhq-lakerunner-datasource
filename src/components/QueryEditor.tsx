import React, { useEffect, useMemo } from 'react';
import {
  MultiSelect,
  InlineFieldRow,
  InlineField,
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
  
  const filters: Filter[] = useMemo(() => query.filters ?? [], [query.filters]);

  const { data: labels = [], isLoading: loadingLabels } = useLogLabels({
    enabled: true,
    filters,
  });

  useEffect(() => {
    if (filters.length === 0 && labels.length > 0) {
      const defaultTag = labels[0];
      onChange({
        ...query,
        filters: [{ tag: defaultTag, op: '=' as Operator, value: [''] }],
      });
      onRunQuery();
    }
  }, [filters, labels, query, onChange, onRunQuery]);

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...query, filters: updated });
    onRunQuery();
  };

  const addFilter = () => {
    const defaultTag = labels[0] ?? '';
    const updated = [...filters, { tag: defaultTag, op: '=' as Operator, value: [''] }];
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
          addFilter={addFilter}
          onRunQuery={onRunQuery}
        />
      
      ))}

      <InlineFieldRow style={{ marginTop: 8, alignItems: 'center' }}>
        <InlineField label="Group by" grow>
          <MultiSelect
            placeholder="Select labels"
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
            width={40}
          />
        </InlineField>
      </InlineFieldRow>
    </div>
  );
}
