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

import { DataFrame, DataQueryRequest, FieldType, toDataFrame } from '@grafana/data';
import { MyQuery } from 'types';
import { matchesThreshold, SeriesSummary } from '../util/threshold';
import { colorForSeries } from '../util/seriesColor';
import { rateWindowForRange } from '../util/rateWindow';

/**
 * Rewrite all PromQL range-vector windows (e.g. `[5m]`, `[20s]`) to the
 * window appropriate for the current time range.  This ensures the window
 * matches the actual query span even when the UI hasn't re-rendered yet.
 */
export function applyRateWindow(expr: string, startMs: number, endMs: number): string {
  const w = rateWindowForRange(startMs, endMs);
  // Match range-vector selectors: `[<duration>]` where duration is digits + unit
  return expr.replace(/\[(\d+[smhdwy])\]/g, `[${w}]`);
}

export function applyLegendFormat(format: string, tags: Record<string, any> | undefined): string | null {
  if (!format) {
    return null;
  }
  if (!tags) {
    return null;
  }
  return format.replace(/\{\{([\w.:\-]+)\}\}/g, (match, key) => {
    const val = tags[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
}

type SeriesBuf = { timestamps: number[]; values: number[]; tags?: Record<string, any> };

/**
 * Fetches per-series summary statistics (min/max/avg/etc.) from the API.
 * Used for value-based filtering before fetching full time series data.
 */
export async function fetchMetricsSummary(
  dataSourceUid: string,
  query: string,
  startTime: number,
  endTime: number,
  signal: AbortSignal
): Promise<SeriesSummary[]> {
  const response = await fetch(`/api/datasources/uid/${dataSourceUid}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/api/v1/metrics/query`,
      body: {
        s: String(startTime),
        e: String(endTime),
        q: query,
        summary: true,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    let errDetail = '';
    try {
      errDetail = await response.text();
    } catch {}
    throw new Error(`Summary request failed http=${response.status}` + (errDetail ? `\n${errDetail}` : ''));
  }

  const summaries: SeriesSummary[] = [];
  let buffer = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      // Flush decoder and process any remaining buffer
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed?.type === 'summary' && parsed.data) {
          summaries.push(parsed.data as SeriesSummary);
        }
      } catch {
        // noop
      }
    }
  }

  // Process any remaining buffered line after stream ends
  if (buffer.trim().startsWith('data:')) {
    try {
      const parsed = JSON.parse(buffer.trim().slice(5).trim());
      if (parsed?.type === 'summary' && parsed.data) {
        summaries.push(parsed.data as SeriesSummary);
      }
    } catch {
      // noop
    }
  }

  return summaries;
}

export async function runPromQLQuery(
  dataSourceUid: string,
  target: MyQuery,
  range: DataQueryRequest['range'],
  signal: AbortSignal,
  emit?: (frames: DataFrame[]) => void,
  supportsMetricsSummarySSE = false
) {
  const startTime = range.from.valueOf();
  const endTime = range.to.valueOf();
  const threshold = target.valueThreshold;
  const promql = target.promqlOutput ? applyRateWindow(target.promqlOutput, startTime, endTime) : target.promqlOutput;

  // If threshold filtering is enabled, fetch summaries first to determine which series to include
  let allowedLabels: Set<string> | null = null;
  if (supportsMetricsSummarySSE && threshold?.enabled && promql) {
    try {
      const summaries = await fetchMetricsSummary(dataSourceUid, promql, startTime, endTime, signal);
      // Filter to only series that match the threshold
      const matchingSummaries = summaries.filter((s) => matchesThreshold(s, threshold));

      // If no summary rows are returned, treat as unsupported behavior and fall back to unfiltered query.
      if (summaries.length > 0) {
        allowedLabels = new Set(matchingSummaries.map((s) => s.label));

        // If no series match, return empty result immediately
        if (allowedLabels.size === 0) {
          if (emit) {
            emit([]);
          }
          return [];
        }
      } else {
        allowedLabels = null;
      }
    } catch (err) {
      // If summary API fails (e.g., older backend), fall back to no filtering
      console.warn('Summary API failed, falling back to unfiltered query:', err);
      allowedLabels = null;
    }
  }

  const response = await fetch(`/api/datasources/uid/${dataSourceUid}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/api/v1/metrics/query`,
      body: {
        s: String(startTime),
        e: String(endTime),
        q: promql,
      },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    let errDetail = '';
    try {
      errDetail = await response.text();
    } catch {}
    throw new Error(
      `PromQL request failed (refId ${target.refId}) http=${response.status}` + (errDetail ? `\n${errDetail}` : '')
    );
  }

  let emitCount = 0;
  let lastEmit = 0;
  const shouldEmit = () => !!emit && (emitCount % 50 === 0 || performance.now() - lastEmit > 250);
  const didEmit = () => {
    lastEmit = performance.now();
  };

  let buffer = '';
  const frameData: Record<string, SeriesBuf> = {};

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const flushMetricFramesInto = (dst: DataFrame[]) => {
    for (const [label, series] of Object.entries(frameData)) {
      const ref = target.refId;
      const displayName = applyLegendFormat(target.legendFormat ?? '', series.tags) ?? label;

      const frame = toDataFrame({
        refId: ref,
        name: label,
        fields: [
          { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: series.values.slice(),
            labels: series.tags ?? undefined,
            config: {
              displayNameFromDS: displayName,
              color: { mode: 'fixed', fixedColor: colorForSeries(label, series.tags) },
            },
          },
        ],
      });

      (frame.meta as any) = { preferredVisualisationType: 'graph' };
      dst.push(frame);
    }
  };

  const toNumberValue = (v: any): number => {
    if (typeof v === 'number') {
      return v;
    }
    if (v && typeof v === 'object' && typeof v.num === 'number') {
      return v.num;
    }
    const n = Number(v?.num ?? v);
    return Number.isFinite(n) ? n : NaN;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed?.type === 'done' || parsed?.type === 'end') {
          const frames: DataFrame[] = [];
          flushMetricFramesInto(frames);
          if (emit && frames.length) {
            emit(frames);
          }
          return frames;
        }
        if (parsed?.type === 'heartbeat') {
          continue;
        }
        if (parsed?.type !== 'result') {
          continue;
        }

        const d = parsed.data;

        if (d && typeof d === 'object' && 'timestamp' in d && 'label' in d) {
          const ts = Number(d.timestamp);
          const val = toNumberValue(d.value);
          if (!Number.isFinite(ts) || !Number.isFinite(val)) {
            continue;
          }

          const label = String(d.label);

          // Skip series that don't match the threshold filter
          if (allowedLabels !== null && !allowedLabels.has(label)) {
            continue;
          }

          if (!frameData[label]) {
            frameData[label] = { timestamps: [], values: [], tags: d.tags ?? undefined };
          }

          frameData[label].timestamps.push(ts);
          frameData[label].values.push(val);
        }

        emitCount++;

        if (shouldEmit()) {
          const batch: DataFrame[] = [];
          flushMetricFramesInto(batch);
          if (batch.length) {
            emit!(batch);
          }
          didEmit();
        }
      } catch (err) {
        // noop
      }
    }
  }

  const frames: DataFrame[] = [];
  flushMetricFramesInto(frames);
  if (emit && frames.length) {
    emit(frames);
  }

  return frames;
}
