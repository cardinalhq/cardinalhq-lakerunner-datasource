import { useQuery } from '@tanstack/react-query';
import { fetchMetricNames } from '../services/tags';

type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';

export function useMetricNames(datasourceId: number, setIsWaiting?: (v: boolean) => void) {
  return useQuery<Array<{ metricName: string; metricType: MetricKind }>>({
    queryKey: ['metric-names', datasourceId],
    queryFn: () => fetchMetricNames({ datasourceId, setIsWaiting }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
