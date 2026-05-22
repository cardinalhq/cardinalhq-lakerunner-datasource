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

export interface DataSourceFeatures {
  metricsSummarySSE: boolean;
}

const defaultFeatures: DataSourceFeatures = {
  metricsSummarySSE: false,
};

export async function fetchDataSourceFeatures(datasourceUid: string, signal?: AbortSignal): Promise<DataSourceFeatures> {
  const res = await fetch(`/api/datasources/uid/${datasourceUid}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/api/v1/features`,
      body: {},
    }),
    signal,
  });

  if (!res.ok) {
    return defaultFeatures;
  }

  try {
    const json = await res.json();
    return {
      metricsSummarySSE: Boolean(json?.features?.metricsSummarySSE),
    };
  } catch {
    return defaultFeatures;
  }
}

