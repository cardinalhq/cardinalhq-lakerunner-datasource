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
import { fetchTagValues } from 'services/tags';
import { truncateTo1Min } from 'util/QueryUtils';

type Mode = 'logs' | 'metrics' | 'traces';

type UseLogQLTagValuesOpts = {
  enabled?: boolean;
  datasourceId: number;
  tagName?: string;
  expr?: string;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (v: boolean) => void;
  mode?: Mode;
};

export function useTagValues({
  enabled = true,
  datasourceId,
  tagName,
  expr,
  startTime = Date.now() - 5 * 60_000,
  endTime = Date.now(),
  setIsWaiting,
  mode = 'logs',
}: UseLogQLTagValuesOpts) {
  const hasTag = !!tagName && tagName.trim().length > 0;
  const enabledFinal = enabled && hasTag;

  const queryKey = [
    'tag-values',
    mode,
    datasourceId,
    tagName ?? '__none__',
    expr ?? '__UNSCOPED__',
    truncateTo1Min(startTime),
    truncateTo1Min(endTime),
  ];

  const {
    data = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<string[], Error>({
    queryKey,
    enabled: enabledFinal,
    queryFn: ({ signal }) => {
      if (!hasTag) {
        return Promise.resolve<string[]>([]);
      }
      return fetchTagValues({
        datasourceId,
        tagName: tagName!,
        expr,
        startTime,
        endTime,
        signal,
        setIsWaiting,
        mode,
      });
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });

  return { values: data, loading: isLoading || isFetching, error, refetch };
}
