import { useQuery } from '@tanstack/react-query';
import { fetchTagKeys } from 'services/logs';

export function useLogLabels({ enabled }: { enabled: boolean }) {
  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey: ['log-labels', 'e-1h-to-now'],
    queryFn: ({ signal }) => fetchTagKeys({ useRelativeTime: true, signal }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
