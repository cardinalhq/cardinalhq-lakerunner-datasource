import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';
import type { Filter } from '../types';
import type { DataSource } from '../datasource';

interface UseLabelsProps {
  datasource: DataSource;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics';
}

export function useLogLabels({ 
  datasource,
  enabled, 
  filters = [], 
  mode = 'logs' 
}: UseLabelsProps) {
  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey: ['labels', mode, 'e-1h-to-now', filters],
    queryFn: ({ signal }) =>
      fetchTagKeys({ 
        apiUrl: datasource.getApiUrl(),
        apiKey: datasource.getApiKey(), 
        useRelativeTime: true, 
        filters, 
        signal, 
        mode }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
