import React, { useState, useEffect } from 'react';
import { InlineField, InlineFieldRow, Stack, Combobox } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';
import { useLogLabels } from '../hooks/useLabels';
import { useLabelValues } from '../hooks/useValues';

export function QueryEditor({
  query,
  onChange,
  onRunQuery,
}: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  const [label, setLabel] = useState(query.tag ?? '');
  const [operator, setOperator] = useState(query.op ?? '=');
  const [value, setValue] = useState(query.value?.[0] ?? '');

  const { data: labels = [], isLoading: loadingLabels } = useLogLabels({ enabled: true });
  const { data: values = [], isLoading: loadingValues } = useLabelValues({
    labelName: label,
    enabled: !!label,
  });

  useEffect(() => {
    onChange({ ...query, tag: label, op: operator, value: [value] });
  }, [label, operator, value]);

  return (
    <Stack gap={1}>
      <InlineField label="Log Filter">
        <InlineFieldRow>
          <Combobox
            options={
              loadingLabels
                ? [{ label: 'Loading tags...', value: '__loading' }]
                : labels.map((l: any) => ({ label: l, value: l }))
            }
            value={label}
            onChange={(v) => {
              const selected = v?.value ?? '';
              setLabel(selected);
              setValue('');
              onRunQuery(); 
            }}
            placeholder="Tag"
            loading={loadingLabels}
          />
          <Combobox
            options={[
              { label: '=', value: '=' },
              { label: '!=', value: '!=' },
              { label: 'in', value: 'in' },
              { label: 'not in', value: 'not_in' },
            ]}
            value={operator}
            width={8}
            onChange={(v) => {
              setOperator(v?.value ?? '=');
              onRunQuery();
            }}
            placeholder="Operator"
            disabled={!label}
          />
          <Combobox
            options={
              loadingValues
                ? [{ label: 'Loading values...', value: '__loading' }]
                : values.map((v: any) => ({ label: v, value: v }))
            }
            value={value}
            onChange={(v) => {
              if (v?.value === '__loading') return;
              setValue(v?.value ?? '');
              onRunQuery();
            }}
            placeholder="Value"
            loading={loadingValues}
            disabled={!label}
          />
        </InlineFieldRow>
      </InlineField>
    </Stack>
  );
}
