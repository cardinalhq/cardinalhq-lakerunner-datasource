import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchTagValues } from 'services/logs';
import { truncateTo1Min } from 'util/QueryUtils';
import type { DataSource } from '../datasource';
import type { Filter } from '../types';

interface UseLabelValuesProps {
  datasource: DataSource;
  labelName: string;
  enabled: boolean;
  filters?: Filter[];
  mode?: 'logs' | 'metrics' | 'promQL' | 'traces';
  metricName?: string;
  metricType?: string;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (v: boolean) => void;
  extract?: {
    regex: string;
    fields: Array<{ name: string; type: 'string' | 'number' }>;
  };
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
  setIsWaiting,
  extract,
}: UseLabelValuesProps) {
  const isInternalMetricLabel = mode === 'metrics' && labelName === '_cardinalhq.name';
  const shouldRun = enabled && !!labelName && !isInternalMetricLabel && (mode !== 'metrics' || !!metricName);
  const scopedFilters = filters.filter((f) => f.tag !== labelName);

  const queryKey = [
    'label-values',
    mode,
    labelName,
    metricName,
    scopedFilters
      .sort((a, b) => a.tag.localeCompare(b.tag))
      .map((f) => `${f.tag}:${f.op}:${f.value.join(',')}`)
      .join('|'),
    truncateTo1Min(startTime),
    truncateTo1Min(endTime),
  ];

  const [labelValues, setLabelValues] = useState<string[]>([]);

  const { isLoading, error } = useQuery<string[], Error>({
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
        setIsWaiting,
        onData: setLabelValues,
        extract,
      }),
    enabled: shouldRun,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { data: labelValues, isLoading, error };
}
