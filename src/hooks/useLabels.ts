import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';
import type { Filter } from '../types';
import type { DataSource } from '../datasource';

interface UseLabelsProps {
  datasource: DataSource;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics';
  startTime?: number;
  endTime?: number;
}

export function useLogLabels({ 
  datasource,
  enabled, 
  filters = [], 
  mode = 'logs',
  startTime = Date.now() - 3600_000,  
  endTime   = Date.now(),
}: UseLabelsProps) {
  const queryKey = [
    'labels',
    mode,
    String(startTime),
    String(endTime),
    JSON.stringify(filters),
  ] as const;

  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey,
    queryFn: ({ signal }) =>
      fetchTagKeys({ 
        apiUrl: datasource.getApiUrl(),
        apiKey: datasource.getApiKey(), 
        useRelativeTime: true, 
        filters, 
        signal, 
        mode,
        startTime,
        endTime 
      }),
    enabled,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
