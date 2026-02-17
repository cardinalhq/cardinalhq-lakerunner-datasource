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

type SeriesBuf = { timestamps: number[]; values: number[] };

/**
 * Fetches per-series summary statistics (min/max/avg/etc.) from the API.
 * Used for value-based filtering before fetching full time series data.
 */
export async function fetchMetricsSummary(
  dataSourceId: number,
  query: string,
  startTime: number,
  endTime: number,
  signal: AbortSignal
): Promise<SeriesSummary[]> {
  const response = await fetch(`/api/datasources/${dataSourceId}/resources/proxy-promql`, {
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

  return summaries;
}

export async function runPromQLQuery(
  dataSourceId: number,
  target: MyQuery,
  range: DataQueryRequest['range'],
  signal: AbortSignal,
  emit?: (frames: DataFrame[]) => void
) {
  const startTime = range.from.valueOf();
  const endTime = range.to.valueOf();
  const threshold = target.valueThreshold;

  // If threshold filtering is enabled, fetch summaries first to determine which series to include
  let allowedLabels: Set<string> | null = null;
  if (threshold?.enabled && target.promqlOutput) {
    try {
      const summaries = await fetchMetricsSummary(dataSourceId, target.promqlOutput, startTime, endTime, signal);
      // Filter to only series that match the threshold
      const matchingSummaries = summaries.filter((s) => matchesThreshold(s, threshold));
      allowedLabels = new Set(matchingSummaries.map((s) => s.label));

      // If no series match, return empty result immediately
      if (allowedLabels.size === 0) {
        if (emit) {
          emit([]);
        }
        return [];
      }
    } catch (err) {
      // If summary API fails (e.g., older backend), fall back to no filtering
      console.warn('Summary API failed, falling back to unfiltered query:', err);
      allowedLabels = null;
    }
  }

  const response = await fetch(`/api/datasources/${dataSourceId}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/api/v1/metrics/query`,
      body: {
        s: String(startTime),
        e: String(endTime),
        q: target.promqlOutput,
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

      const frame = toDataFrame({
        refId: ref,
        name: label,
        fields: [
          { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: series.values.slice(),
            config: {
              displayNameFromDS: label,
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
            frameData[label] = { timestamps: [], values: [] };
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
