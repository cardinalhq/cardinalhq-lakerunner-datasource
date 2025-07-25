import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';
import type { Filter } from '../types';
import type { DataSource } from '../datasource';

interface UseLabelsProps {
  datasource: DataSource;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
  startTime?: number;
  endTime?: number;
}

export function useLogLabels({
  datasource,
  enabled,
  filters = [],
  mode = 'logs',
  metricName,
  metricType,
  startTime = Date.now() - 3600_000,
  endTime = Date.now(),
}: UseLabelsProps) {
  const queryKey = [
    'labels',
    mode,
    String(startTime),
    String(endTime),
    JSON.stringify(filters),
    metricName,
    metricType,
  ] as const;
  const shouldRun = enabled && !!datasource?.id;

  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey,
    queryFn: ({ signal }) => {
      return fetchTagKeys({
        datasourceId: datasource.id,
        useRelativeTime: true,
        filters,
        signal,
        mode,
        startTime,
        endTime,
        metricName,
        metricType,
      });
    },
    enabled: shouldRun,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
