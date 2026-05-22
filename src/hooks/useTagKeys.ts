/*
 * Copyright (C) 2025-2026 CardinalHQ, Inc
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchTags } from '../services/tags';
import { Filter } from '../types';

type Mode = 'logs' | 'metrics' | 'traces';

type Options = {
  datasourceUid: string;
  startTime?: number;
  endTime?: number;
  enabled?: boolean;
  refreshKey?: number;
  setIsWaiting?: (v: boolean) => void;
  filters?: Filter[];
  mode?: Mode;
  metricName?: string;
  expr?: string; // Optional query expression for scoping available tags
};

function buildKey(filters?: Filter[]): string {
  return (filters || [])
    .filter((f) => f.tag?.trim() && f.value?.some((v) => v?.trim()))
    .map((f) => `${f.tag}:${f.op}:${(f.value || []).join(',')}`)
    .sort()
    .join('|');
}

export function useTags({
  datasourceUid,
  startTime = Date.now() - 5 * 60_000,
  endTime = Date.now(),
  enabled = true,
  refreshKey = 0,
  setIsWaiting,
  filters,
  mode = 'logs',
  metricName,
  expr,
}: Options) {
  const filterKey = buildKey(filters);
  const canFetch = enabled && (mode === 'logs' || mode === 'traces' || (mode === 'metrics' && !!metricName));

  const modeKeyPart = mode === 'metrics' ? metricName ?? '__no_metric__' : '';

  const queryKey = [
    'tags',
    mode,
    datasourceUid,
    modeKeyPart,
    filterKey,
    expr ?? '',
    Math.floor(startTime / 60_000),
    Math.floor(endTime / 60_000),
    refreshKey,
  ];

  const {
    data = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery<string[], Error>({
    queryKey,
    enabled: canFetch,
    queryFn: ({ signal }) =>
      fetchTags({
        datasourceUid,
        startTime,
        endTime,
        setIsWaiting,
        mode,
        metricName,
        expr,
        signal,
      }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  return { data, loading: isLoading || isFetching, error, refetch };
}
