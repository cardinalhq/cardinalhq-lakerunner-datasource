import { useQuery } from '@tanstack/react-query';
import { fetchTags } from '../services/tags';
import { Filter } from '../types';

type Mode = 'logs' | 'metrics' | 'traces';

type Options = {
  datasourceId: number;
  startTime?: number;
  endTime?: number;
  enabled?: boolean;
  refreshKey?: number;
  setIsWaiting?: (v: boolean) => void;
  filters?: Filter[];
  mode?: Mode;
  metricName?: string;
};

function buildKey(filters?: Filter[]): string {
  return (filters || [])
    .filter((f) => f.tag?.trim() && f.value?.some((v) => v?.trim()))
    .map((f) => `${f.tag}:${f.op}:${(f.value || []).join(',')}`)
    .sort()
    .join('|');
}

export function useTags({
  datasourceId,
  startTime = Date.now() - 5 * 60_000,
  endTime = Date.now(),
  enabled = true,
  refreshKey = 0,
  setIsWaiting,
  filters,
  mode = 'logs',
  metricName,
}: Options) {
  const filterKey = buildKey(filters);
  const canFetch = enabled && (mode === 'logs' || mode === 'traces' || (mode === 'metrics' && !!metricName));

  const modeKeyPart = mode === 'metrics' ? metricName ?? '__no_metric__' : '';

  const queryKey = [
    'tags',
    mode,
    datasourceId,
    modeKeyPart,
    filterKey,
    Math.floor(startTime / 60_000),
    Math.floor(endTime / 60_000),
    refreshKey,
  ];

  const {
    data = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<string[], Error>({
    queryKey,
    enabled: canFetch,
    queryFn: ({ signal }) =>
      fetchTags({
        datasourceId,
        startTime,
        endTime,
        setIsWaiting,
        mode,
        metricName,
        signal,
      }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  return { data, loading: isLoading || isFetching, error, refetch };
}
