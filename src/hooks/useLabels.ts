import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';
import { truncateTo1Min } from 'util/QueryUtils';
import type { DataSource } from '../datasource';
import type { Filter } from '../types';

interface UseLabelsProps {
  datasource: DataSource;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics' | 'promQL' | 'traces';
  metricName?: string;
  metricType?: string;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (v: boolean) => void;
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
}: UseLabelsProps) {
  const queryKey = [
    'labels',
    mode,
    truncateTo1Min(startTime),
    truncateTo1Min(endTime),
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
        setIsWaiting,
      });
    },
    enabled: shouldRun,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
