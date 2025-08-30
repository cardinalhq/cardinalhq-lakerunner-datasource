import React, { ChangeEvent } from 'react';
import { InlineField, InlineSwitch, Input, SecretInput } from '@grafana/ui';
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

  const onToggleTraces = (v: boolean) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        enableTraces: v,
      },
    });
  };

  const onTogglePromQL = (v: boolean) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        enablePromQL: v,
      },
    });
  };
  const onPromQLPathChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        promQLPath: e.target.value,
      },
    });
  };

  return (
    <>
      <InlineField label="Query API Root">
        <Input
          id="config-editor-path"
          value={jsonData.customPath || ''}
          onChange={onPathChange}
          placeholder="e.g. https://your-api.com"
          width={40}
        />
      </InlineField>

      <InlineField label="API Key">
        <SecretInput
          isConfigured={secureJsonFields.apiKey === true}
          value={secureJsonData.apiKey || ''}
          placeholder="Enter your API key"
          onReset={onResetApiKey}
          onChange={onApiKeyChange}
          width={40}
        />
      </InlineField>

      <div style={{ marginTop: 16 }}>
        <InlineField label="Experimental Traces support">
          <InlineSwitch
            value={options.jsonData.enableTraces || false}
            onChange={(e) => onToggleTraces(e.currentTarget.checked)}
          />
        </InlineField>
      </div>

      <div style={{ marginTop: 8 }}>
        <InlineField label="Experimental PromQL support">
          <InlineSwitch
            value={options.jsonData.enablePromQL || false}
            onChange={(e) => onTogglePromQL(e.currentTarget.checked)}
          />
        </InlineField>
        {options.jsonData.enablePromQL && (
          <InlineField label="PromQL API Root">
            <Input
              id="config-editor-path-promql"
              value={jsonData.promQLPath || ''}
              onChange={onPromQLPathChange}
              placeholder="e.g. https://your-api.com"
              width={40}
            />
          </InlineField>
        )}
      </div>
    </>
  );
}
