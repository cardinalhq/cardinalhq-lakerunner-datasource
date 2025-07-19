import React, { ChangeEvent } from 'react';
import { InlineField, Input } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions> {}

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData } = options;

  const onPathChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        customPath: e.target.value,
      },
    });
  };

  const onApiKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        apiKey: e.target.value,
      },
    });
  };

  return (
    <>
      <InlineField label="Path" labelWidth={14} interactive tooltip="Base URL or custom path">
        <Input
          id="config-editor-path"
          value={jsonData.customPath || ''}
          onChange={onPathChange}
          placeholder="e.g. /api/v1"
          width={40}
        />
      </InlineField>

      <InlineField label="API Key" labelWidth={14} interactive tooltip="Your CardinalHQ API key">
        <Input
          id="config-editor-api-key"
          value={jsonData.apiKey || ''}
          onChange={onApiKeyChange}
          placeholder="Enter your API key"
          width={40}
        />
      </InlineField>
    </>
  );
}
