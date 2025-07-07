import { useQuery } from '@tanstack/react-query';
import { fetchTagValues } from 'services/logs';
import type { Filter } from '../types';

interface UseLabelValuesProps {
  labelName: string;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
}
export function useLabelValues({
  labelName,
  enabled,
  filters = [],
  mode = 'logs',
  metricName,
  metricType,
}: UseLabelValuesProps) {
  const shouldRun = enabled && !!labelName && (mode !== 'metrics' || !!metricName);

  const { data = [], isLoading, error } = useQuery<string[], Error>({
    queryKey: [
      'label-values',
      mode,
      labelName,
      JSON.stringify(filters),
      metricName,
    ],
    queryFn: ({ signal }) =>
      fetchTagValues({
        mode,
        labelName,
        filters,
        useRelativeTime: true,
        signal,
        metricName,
        metricType,
      }),
    enabled: shouldRun,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (mode === 'metrics' && labelName === '_cardinalhq.name') {
    return { data: [], isLoading: false, error: undefined };
  }

  return { data, isLoading, error };
}
