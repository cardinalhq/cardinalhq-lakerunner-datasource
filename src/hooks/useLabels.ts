import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';
import type { Filter } from '../types';

interface UseLogLabelsProps {
  enabled: boolean;
  filters?: Filter[];
}

export function useLogLabels({ enabled, filters = [] }: UseLogLabelsProps) {
  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey: ['log-labels', 'e-1h-to-now', filters],
    queryFn: ({ signal }) =>
      fetchTagKeys({ useRelativeTime: true, filters, signal }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
