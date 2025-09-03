import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { fetchTagKeys } from 'services/logs';
import { truncateTo1Min } from 'util/QueryUtils';
import type { DataSource } from '../datasource';
import type { Filter } from '../types';

interface UseLabelsProps {
  datasource: DataSource;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics' | 'promQL' | 'logQL' | 'traces';
  metricName?: string;
  metricType?: string;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (v: boolean) => void;
  extract?: {
    regex: string;
    fields: Array<{ name: string; type: 'string' | 'number' }>;
  };
  refreshKey?: number;
}

export function useLabels({
  datasource,
  enabled,
  filters = [],
  mode = 'logs',
  metricName,
  metricType,
  startTime = Date.now() - 3600_000,
  endTime = Date.now(),
  setIsWaiting,
  extract,
  refreshKey = 0,
}: UseLabelsProps) {
  const [labels, setLabels] = useState<string[]>([]);
  const queryKey = useMemo(
    () =>
      [
        'labels',
        datasource?.id ?? 0,
        mode,
        truncateTo1Min(startTime),
        truncateTo1Min(endTime),
        JSON.stringify(filters ?? []),
        metricName ?? '',
        metricType ?? '',
        extract ? JSON.stringify({ regex: extract.regex, fields: extract.fields }) : 'no-extractor',
        refreshKey,
      ] as const,
    [datasource?.id, mode, startTime, endTime, filters, metricName, metricType, extract, refreshKey]
  );

  const shouldRun = enabled && !!datasource?.id;

  const { isLoading } = useQuery<string[], Error>({
    queryKey,
    queryFn: ({ signal }) =>
      fetchTagKeys({
        datasourceId: datasource.id,
        useRelativeTime: true,
        filters,
        signal,
        mode,
        startTime,
        endTime,
        metricName,
        metricType,
        setIsWaiting,
        onData: (incoming) => {
          const filtered = incoming.filter((label) => label !== 'nlp_struct');
          setLabels(filtered);
        },
        extract,
      }),
    enabled: shouldRun,
    staleTime: 50,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  return { data: labels, isLoading };
}
