import { useQuery } from '@tanstack/react-query';
import { fetchTagValues } from 'services/logs';
import type { Filter } from '../types';

interface UseLabelValuesProps {
  labelName: string;
  enabled: boolean;
  filters?: Filter[];
}

export function useLabelValues({
  labelName,
  enabled,
  filters = [],
}: UseLabelValuesProps) {
  const shouldRun = enabled && !!labelName;
  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey: ['log-label-values', labelName, filters],
    queryFn: ({ signal }) =>
      fetchTagValues({
        labelName,
        filters,
        useRelativeTime: true,
        signal,
      }),
    enabled: shouldRun,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { data, isLoading };
}
