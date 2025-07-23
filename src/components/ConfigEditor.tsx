import React, { ChangeEvent } from 'react';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions, MySecureJsonData } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData> {}

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonData = {}, secureJsonFields = {} } = options;

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
      secureJsonData: {
        ...secureJsonData,
        apiKey: e.target.value,
      },
    });
  };

  const onResetApiKey = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: {
        ...secureJsonFields,
        apiKey: false,
      },
      secureJsonData: {
        ...secureJsonData,
        apiKey: '',
      },
    });
  };

  return (
    <>
      <InlineField label="Path" labelWidth={14} tooltip="Base URL or custom path">
        <Input
          id="config-editor-path"
          value={jsonData.customPath || ''}
          onChange={onPathChange}
          placeholder="e.g. https://your-api.com"
          width={40}
        />
      </InlineField>

      <InlineField label="API Key" labelWidth={14} tooltip="Your CardinalHQ API key">
        <SecretInput
          isConfigured={secureJsonFields.apiKey === true}
          value={secureJsonData.apiKey || ''}
          placeholder="Enter your API key"
          onReset={onResetApiKey}
          onChange={onApiKeyChange}
          width={40}
        />
      </InlineField>
    </>
  );
}
