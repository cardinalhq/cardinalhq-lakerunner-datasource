import { useQuery } from '@tanstack/react-query';
import { fetchTagValues } from 'services/logs';

export function useLabelValues({
  labelName,
  enabled,
}: {
  labelName: string;
  enabled: boolean;
}) {
  const { data = [], isLoading } = useQuery<string[], Error>({
    queryKey: ['log-label-values', labelName],
    queryFn: ({ signal }) =>
      fetchTagValues({ labelName, useRelativeTime: true, signal }),
    enabled: enabled && Boolean(labelName),
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return { data, isLoading };
}
