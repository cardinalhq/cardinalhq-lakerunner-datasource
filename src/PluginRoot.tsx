// src/PluginRoot.tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryEditorProps } from '@grafana/data';
import { QueryEditor } from './components/QueryEditor';
import { MyQuery, MyDataSourceOptions } from './types';
import { DataSource } from './datasource';

const queryClient = new QueryClient();

export function PluginRoot(props: QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>) {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryEditor {...props} />
    </QueryClientProvider>
  );
}
