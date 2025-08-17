import React, { ChangeEvent } from 'react';
import { InlineField, InlineSwitch, Input, SecretInput } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { MyDataSourceOptions, MySecureJsonData } from '../types';

interface Props extends DataSourcePluginOptionsEditorProps<MyDataSourceOptions, MySecureJsonData> {}

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonData = {}, secureJsonFields = {} } = options;

  const onToggleAdvancedTab = (v: boolean) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        enableAdvancedTab: v,
      },
    });
  };
  const onPathChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        customPath: e.target.value,
      },
    });
  };
  const onPromqlChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        promqlPath: e.target.value,
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
      <InlineField label="Enable Experimental PromQL" tooltip="Show the promql tab in the query editor">
        <InlineSwitch
          value={options.jsonData.enableAdvancedTab || false}
          onChange={(e) => onToggleAdvancedTab(e.currentTarget.checked)}
        />
      </InlineField>
      {options.jsonData.enableAdvancedTab && (
        <InlineField label="PromQL Path" labelWidth={18} tooltip="PromQL path">
          <Input
            id="config-editor-path-promql"
            value={jsonData.promqlPath || ''}
            onChange={onPromqlChange}
            placeholder="e.g. https://your-api.com"
            width={40}
          />
        </InlineField>
      )}
    </>
  );
}
