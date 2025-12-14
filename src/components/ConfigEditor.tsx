/*
 * Copyright (C) 2025-2026 CardinalHQ, Inc
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

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

      <div style={{ marginTop: 16, display: 'none' }}>
        <InlineField label="Experimental Traces support">
          <InlineSwitch
            value={options.jsonData.enableTraces || false}
            onChange={(e) => onToggleTraces(e.currentTarget.checked)}
          />
        </InlineField>
      </div>
    </>
  );
}
