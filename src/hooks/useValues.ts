import { useQuery } from '@tanstack/react-query';
import { fetchTagValues } from 'services/logs';
import type { Filter } from '../types';
import type { DataSource } from '../datasource';

interface UseLabelValuesProps {
  datasource: DataSource;
  labelName: string;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
  startTime?: number;
  endTime?: number;
}

export function useLabelValues({
  datasource,
  labelName,
  enabled,
  filters = [],
  mode = 'logs',
  metricName,
  metricType,
  startTime = Date.now() - 3600_000,
  endTime = Date.now(),
}: UseLabelValuesProps) {
  const isInternalMetricLabel = mode === 'metrics' && labelName === '_cardinalhq.name';
  const shouldRun = enabled && !!labelName && !isInternalMetricLabel && (mode !== 'metrics' || !!metricName);
  const scopedFilters = filters.filter((f) => f.tag !== labelName);

  const queryKey = [
    'label-values',
    mode,
    labelName,
    metricName,
    scopedFilters.map((f) => `${f.tag}:${f.op}:${f.value.join(',')}`).join('|'),
  ];

  const {
    data = [],
    isLoading,
    error,
  } = useQuery<string[], Error>({
    queryKey,
    queryFn: ({ signal }) =>
      fetchTagValues({
        datasourceId: datasource.id,
        mode,
        labelName,
        filters: scopedFilters,
        useRelativeTime: true,
        signal,
        metricName,
        metricType,
        startTime,
        endTime,
      }),
    enabled: shouldRun,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { data, isLoading, error };
}
