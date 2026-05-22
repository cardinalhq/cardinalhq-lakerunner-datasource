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
import { fetchMetricNames } from '../services/tags';

type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';

export function useMetricNames(datasourceUid: string, setIsWaiting?: (v: boolean) => void) {
  return useQuery<Array<{ metricName: string; metricType: MetricKind }>>({
    queryKey: ['metric-names', datasourceUid],
    queryFn: () => fetchMetricNames({ datasourceUid, setIsWaiting }),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
