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

type Mode = 'logs' | 'metrics' | 'traces';

export function displayTagName(tag: string): string {
  return tag;
}

export function queryTagName(tag: string): string {
  return tag.replace(/\./g, '_');
}

export function toInternalLabel(label: string): string {
  return label;
}

export function toUserLabel(label: string): string {
  return label;
}

export async function fetchTags(opts: {
  datasourceId: number;
  mode?: Mode;
  startTime?: number;
  endTime?: number;
  signal?: AbortSignal;
  setIsWaiting?: (v: boolean) => void;
  metricName?: string;
  expr?: string; // Optional query expression for scoping available tags
}): Promise<string[]> {
  const { datasourceId, startTime, endTime, signal, setIsWaiting, mode = 'logs', metricName, expr } = opts;

  const s = String(startTime ?? Date.now() - 5 * 60_000);
  const e = String(endTime ?? Date.now());
  const base = mode === 'metrics' ? '/api/v1/metrics' : mode === 'traces' ? '/api/v1/spans' : '/api/v1/logs';

  try {
    setIsWaiting?.(true);

    const body: Record<string, any> = { s, e };
    if (mode === 'metrics' && metricName) {
      body.metric = metricName;
    }
    // Add query expression for scoping tags (all modes support this)
    if (expr) {
      body.q = expr;
    }

    const res = await fetch(`/api/datasources/${datasourceId}/resources/proxy-promql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `${base}/tags`,
        body,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`tags http ${res.status}`);
    }

    const data = (await res.json()) as { tags?: string[] } | string[];
    const tags = Array.isArray(data) ? data : Array.isArray((data as any).tags) ? (data as any).tags : [];

    return tags
      .filter((t: string) => !(t.startsWith('_cardinalhq_') || t.startsWith('chq_')))
      .map(displayTagName);
  } finally {
    setIsWaiting?.(false);
  }
}

export async function fetchTagValues(opts: {
  datasourceId: number;
  mode?: Mode;
  tagName: string;
  startTime?: number;
  endTime?: number;
  expr?: string;
  signal?: AbortSignal;
  setIsWaiting?: (v: boolean) => void;
}): Promise<string[]> {
  const { datasourceId, tagName, startTime, mode = 'logs', endTime, expr, signal, setIsWaiting } = opts;

  const s = String(startTime ?? Date.now() - 5 * 60_000);
  const e = String(endTime ?? Date.now());

  const base = mode === 'metrics' ? '/api/v1/metrics' : mode === 'traces' ? '/api/v1/spans' : '/api/v1/logs';

  const internalTagName = queryTagName(tagName);
  const params = new URLSearchParams({ tagName: internalTagName });
  const path = `${base}/tagvalues?${params.toString()}`;

  try {
    setIsWaiting?.(true);
    const res = await fetch(`/api/datasources/${datasourceId}/resources/proxy-promql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        body: {
          ...(expr ? { q: expr } : {}),
          s,
          e,
        },
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`tagvalues http ${res.status}`);
    }

    const text = await res.text();
    const values: string[] = [];

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const jsonStr = line.slice(5).trim();
      if (!jsonStr) {
        continue;
      }

      try {
        const evt = JSON.parse(jsonStr);
        if (evt?.type === 'result') {
          const v = evt?.data?.value;
          if (typeof v === 'string' && v.length > 0) {
            values.push(v);
          }
        }
      } catch {}
    }

    const seen = new Set<string>();
    return values.filter((v) => (seen.has(v) ? false : (seen.add(v), true)));
  } finally {
    setIsWaiting?.(false);
  }
}

export type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';

export async function fetchMetricNames(opts: {
  datasourceId: number;
  signal?: AbortSignal;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (v: boolean) => void;
}): Promise<Array<{ metricName: string; metricType: MetricKind }>> {
  const { datasourceId, signal, setIsWaiting } = opts;

  const normalizeType = (t?: string): MetricKind => {
    const v = String(t ?? '').toLowerCase();
    if (v === 'counter') {
      return 'counter';
    }
    if (v === 'gauge') {
      return 'gauge';
    }
    if (v === 'histogram') {
      return 'histogram';
    }
    if (v === 'summary') {
      return 'summary';
    }
    if (v === 'sum') {
      return 'sum';
    }
    return 'gauge';
  };

  try {
    setIsWaiting?.(true);

    const res = await fetch(`/api/datasources/${datasourceId}/resources/proxy-promql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `/api/v1/metrics/metadata`,
        body: {},
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`metrics metadata http ${res.status}`);
    }

    const json = await res.json();

    let out: Array<{ metricName: string; metricType: MetricKind }> = [];

    if (json && Array.isArray(json.metrics)) {
      out = json.metrics
        .map((m: any) => ({
          metricName: m.metricName ?? m.name ?? '',
          metricType: normalizeType(m.metricType ?? m.type),
        }))
        .filter((m: any) => m.metricName);
    } else if (Array.isArray(json)) {
      out = json
        .map((m: any) => ({
          metricName: m.metricName ?? m.name ?? '',
          metricType: normalizeType(m.metricType ?? m.type),
        }))
        .filter((m: any) => m.metricName);
    } else if (json && json.data && typeof json.data === 'object') {
      out = Object.entries(json.data).map(([name, arr]: [string, any]) => ({
        metricName: name,
        metricType: normalizeType(Array.isArray(arr) && arr[0]?.type),
      }));
    }

    const seen = new Set<string>();
    const deduped = out.filter(({ metricName }) => (seen.has(metricName) ? false : (seen.add(metricName), true)));
    deduped.sort((a, b) => a.metricName.localeCompare(b.metricName));
    return deduped;
  } finally {
    setIsWaiting?.(false);
  }
}
