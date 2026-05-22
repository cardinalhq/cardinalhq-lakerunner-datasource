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

import { DataFrame, DataQueryRequest, DataFrameType, FieldType, toDataFrame } from '@grafana/data';
import { withHiddenFingerprint } from '../util/buildFinalLogQL';
import { buildLogQLPlans } from 'util/LogqlBuilder';
import { colorForSeries } from '../util/seriesColor';

const LEVEL_FIELD = 'level';

const replaceInterval = (expr: string, window: string) => expr.replace(/\[\s*\$?__interval\s*\]/g, `[${window}]`);

function ensureByLevel(expr: string): string {
  const m = expr.match(/^\s*([a-zA-Z_][\w]*)\s*(?:by\s*\(([^)]*)\))?\s*\(([\s\S]+)\)\s*$/);
  if (!m) {
    return expr;
  }
  const agg = m[1];
  const byList = (m[2] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const want = [LEVEL_FIELD];
  const next = Array.from(new Set([...byList, ...want]));
  return `${agg} by (${next.join(',')})(${m[3]})`;
}

export const SKIP_QUERY_MARKER = '__SKIP_QUERY__';

function ensureStreamSelector(expr: string): string {
  const trimmed = (expr ?? '').trim();

  if (!trimmed) {
    return SKIP_QUERY_MARKER;
  }

  const hasAnySelector = /\{[^}]*\}/.test(trimmed);
  const hasNonEmptySelector = /\{[^}]*[A-Za-z_][\w.\-]*\s*(?:=|=~|!=|!~)\s*"(?:[^"\\]|\\.)*"[^}]*\}/.test(trimmed);

  if (trimmed.startsWith('|')) {
    return SKIP_QUERY_MARKER;
  }

  if (hasAnySelector && hasNonEmptySelector) {
    return trimmed;
  }

  if (hasAnySelector && !hasNonEmptySelector) {
    return SKIP_QUERY_MARKER;
  }

  const firstPipe = trimmed.indexOf('|');
  if (firstPipe > -1) {
    return SKIP_QUERY_MARKER;
  }

  return SKIP_QUERY_MARKER;
}

type Labels = Record<string, any>;
function planForTarget(target: any) {
  const plans = buildLogQLPlans(
    {
      filters: target.filters,
      valueAs: target.valueAs,
      logqlAggregation: target.logqlAggregation,
      groupBy: target.groupBy,
      extractor: target.extractor,
    },
    '__interval'
  );

  if (plans.length === 1 && plans[0].kind === 'aggregated') {
    const expr = plans[0].expr;
    return { kind: 'aggregated' as const, mainExpr: expr, volumeExpr: expr };
  }

  const filterPlan = plans.find((p) => p.role === 'filter');
  const wrappedPlan = plans.find((p) => p.role === 'wrapped');
  const filterExpr = filterPlan?.expr ?? '{}';
  let volumeExpr = wrappedPlan?.expr ?? filterExpr;
  volumeExpr = ensureByLevel(volumeExpr);

  return { kind: 'pure' as const, mainExpr: filterExpr, volumeExpr };
}

const prettyLabel = (s: string) => s.replace(/chq\./g, '');

const baseLogLabelsFrom = (tags: Labels, target?: any): Labels => {
  const out: Labels = {};
  for (const [k, v] of Object.entries(tags || {})) {
    if ((k.startsWith('chq') && k !== 'chq_tsns') || k.startsWith('_cardinalhq_')) {
      continue;
    }
    if (k === '__extracted_struct') {
      continue;
    }
    out[k] = v;
  }
  return out;
};

const AGG_FUNCS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'rate',
  'increase',
  'count_over_time',
  'sum_over_time',
  'min_over_time',
  'max_over_time',
  'avg_over_time',
  'rate_counter',
  'last_over_time',
];

function looksAggregated(expr: string): boolean {
  return AGG_FUNCS.some((fn) => expr.includes(fn + '('));
}

export async function runLogQLQuery(
  datasourceUid: string,
  target: any,
  range: DataQueryRequest['range'],
  signal: AbortSignal,
  emit?: (frames: DataFrame[]) => void
): Promise<DataFrame[]> {
  const isVolume = target.queryText === 'volume';

  const startMs = Number(range?.from?.valueOf?.() ?? Date.now() - 6 * 60 * 60 * 1000);
  const endMs = Number(range?.to?.valueOf?.() ?? Date.now());

  let chosen: string;
  let kind: 'pure' | 'aggregated';
  const usingCode = target.logqlSubTab === 'code';
  const PURE_WINDOW = getIntervalForTimeRange(startMs, endMs);
  const AGG_WINDOW = '5m';

  if (usingCode) {
    const userExpr = (target.logqlOutput || '').trim();
    const isAggregated = looksAggregated(userExpr) || /\blast_over_time\s*\(/i.test(userExpr);
    kind = isAggregated ? 'aggregated' : 'pure';

    if (kind === 'pure') {
      if (isVolume) {
        let volumeExpr = `sum(count_over_time(${userExpr}[__interval]))`;
        volumeExpr = ensureByLevel(volumeExpr);
        chosen = replaceInterval(volumeExpr, PURE_WINDOW);
      } else {
        chosen = replaceInterval(userExpr, PURE_WINDOW);
      }
    } else {
      const userWindow = (target.window || target.interval || '').trim();
      const baseExpr = userWindow ? replaceInterval(userExpr, userWindow) : userExpr;
      chosen = baseExpr;
    }
  } else {
    const plan = planForTarget(target);
    kind = plan.kind;
    chosen = isVolume ? plan.volumeExpr : plan.mainExpr;
    chosen = kind === 'pure' ? replaceInterval(chosen, PURE_WINDOW) : replaceInterval(chosen, AGG_WINDOW);
  }

  chosen = ensureStreamSelector(chosen);

  if (chosen === SKIP_QUERY_MARKER) {
    return [];
  }

  const shouldApplyFingerprint = !target.logqlEdited;
  const expr = shouldApplyFingerprint ? withHiddenFingerprint(chosen, target.selectedFingerprint) : chosen;
  const s = String(startMs);
  const e = String(endMs);

  const direction = target.direction ?? 'backward';
  const reverse = direction === 'backward';
  const body: any = { q: expr, s, e, reverse, limit: 1000 };
  const fields = target.logqlSubTab === 'builder' ? target.builderFields : target.codeFields;
  if (Array.isArray(fields) && fields.length > 0) {
    body.fields = fields;
  }

  const res = await fetch(`/api/datasources/uid/${datasourceUid}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `/api/v1/logs/query`, body }),
    signal,
  });

  if (!res.ok || !res.body) {
    let errDetail = '';
    try {
      errDetail = await res.text();
    } catch {}
    throw new Error(
      `LogQL request failed (refId ${target.refId}) http=${res.status}` + (errDetail ? `\n${errDetail}` : '')
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const seriesMap: Record<string, { ts: number[]; vals: number[]; labels?: Labels }> = {};
  const timestamps: number[] = [];
  const nanosArr: number[] = [];
  const bodies: string[] = [];
  const severities: string[] = [];
  const ids: string[] = [];
  const labelsArr: Labels[] = [];
  const fingerprints: string[] = [];
  const frames: DataFrame[] = [];
  const MAX_INITIAL = 1000;

  const levelColors: Record<string, string> = { debug: '#C8C8C8', info: '#32CD32', warn: '#FFD700', error: '#DC143C' };

  const flushSeriesInto = (dst: DataFrame[]) => {
    for (const [name, s] of Object.entries(seriesMap)) {
      const lab = s.labels ?? {};
      const lvlRaw = lab['level'];
      const levelStr = lvlRaw ? String(lvlRaw) : undefined;
      const fixedColor = levelStr ? levelColors[levelStr.toLowerCase()] : undefined;
      const pretty = prettyLabel(name);
      const fieldLabels = levelStr ? { ...lab, level: levelStr } : lab;
      const frame = toDataFrame({
        refId: target.refId,
        name: pretty,
        fields: [
          { name: 'Time', type: FieldType.time, values: s.ts.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: s.vals.slice(),
            labels: fieldLabels as any,
            config: {
              displayNameFromDS: pretty,
              color: { mode: 'fixed', fixedColor: fixedColor ?? colorForSeries(name, lab) },
            },
          },
        ],
      });
      (frame.meta as any) = { preferredVisualizationType: 'graph' };
      dst.push(frame);
    }
  };

  const extractSearchWords = (tgt: any): string[] => {
    const words: string[] = [];
    const add = (s?: string) => {
      if (!s) {
        return;
      }
      const v = String(s).trim();
      if (v && !words.includes(v)) {
        words.push(v);
      }
    };

    const MSG_TAG = 'message';

    for (const f of Array.isArray(tgt?.filters) ? tgt.filters : []) {
      const tag = String(f?.tag ?? '');
      if (tag !== MSG_TAG) {
        continue;
      }

      const op = String(f?.op ?? '').toLowerCase();
      if (op !== 'contains' && op !== 'contains_icase') {
        continue;
      }

      const vals: string[] = Array.isArray(f?.value) ? f.value : [];
      for (const raw of vals) {
        add(raw);
      }
    }

    return words.slice(0, 12);
  };

  const buildLogsFrame = (): DataFrame => {
    const searchWords = extractSearchWords(target);

    // Always sort logs descending (newest first)
    // This is what Grafana expects - it will handle display order via its flip button
    // The 'direction' parameter ONLY controls which logs to fetch, NOT display order
    const indices = timestamps.map((_, i) => i);
    indices.sort((a, b) => timestamps[b] - timestamps[a]);

    // Reorder all arrays based on sorted indices
    const sortedTimestamps = indices.map(i => timestamps[i]);
    const sortedNanos = indices.map(i => nanosArr[i]);
    const sortedBodies = indices.map(i => bodies[i]);
    const sortedSeverities = indices.map(i => severities[i]);
    const sortedIds = indices.map(i => ids[i]);
    const sortedLabelsArr = indices.map(i => labelsArr[i]);
    const sortedFingerprints = indices.map(i => fingerprints[i]);

    const f = toDataFrame({
      refId: target.refId,
      name: 'logs',
      fields: [
        { name: 'timestamp', type: FieldType.time, values: sortedTimestamps, nanos: sortedNanos },
        { name: 'body', type: FieldType.string, values: sortedBodies },
        { name: 'severity', type: FieldType.string, values: sortedSeverities },
        { name: 'id', type: FieldType.string, values: sortedIds },
        { name: 'labels', type: FieldType.other, values: sortedLabelsArr },
        { name: 'fingerprint', type: FieldType.string, values: sortedFingerprints },
      ],
    });
    f.meta = {
      type: DataFrameType.LogLines,
      preferredVisualisationType: 'logs',
      custom: {
        limit: MAX_INITIAL,
        ...(searchWords.length ? { searchWords } : {}),
      },
    };
    return f;
  };

  const asTags = (d: any): Labels => d?.tags ?? d?.labels ?? d?.attributes ?? {};
  const asBody = (d: any, tags: Labels) =>
    d?.body ?? d?.line ?? tags['message'] ?? '';
  const looksLikeVolumePoint = (d: any) => {
    const t = asTags(d);
    if (typeof d?.value === 'number' && t?.name === '__logql_logs_total') {
      return true;
    }
    const lbl = String(d?.label ?? '');
    if (typeof d?.value === 'number') {
      if (AGG_FUNCS.some((fn) => new RegExp(fn, 'i').test(lbl))) {
        if (
          !('message' in (t || {})) &&
          !('body' in (d || {})) &&
          !('line' in (d || {}))
        ) {
          return true;
        }
      }
    }
    return false;
  };

  let buffer = '';
  let seen = 0;
  let lastEmit = 0;
  const shouldEmit = () => !!emit && (seen % 50 === 0 || performance.now() - lastEmit > 250);
  const didEmit = () => {
    lastEmit = performance.now();
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      let payload: any;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (payload?.type === 'done' || payload?.type === 'end') {
        if (Object.keys(seriesMap).length) {
          flushSeriesInto(frames);
        }
        if (!isVolume && timestamps.length > 0) {
          frames.push(buildLogsFrame());
        }
        if (emit && frames.length) {
          emit(frames);
        }
        return frames;
      }
      if (payload?.type === 'heartbeat') {
        continue;
      }
      if (payload.type !== 'result' || !payload.data) {
        continue;
      }

      const d = payload.data;

      if (looksLikeVolumePoint(d)) {
        const ts = Number(d.timestamp);
        const val = Number(d.value);
        const tags: Labels = asTags(d) ?? {};
        const key =
          d.key ||
          Object.entries(tags)
            .filter(([k]) => k !== 'name')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(', ') || 'series';
        if (!seriesMap[key]) {
          seriesMap[key] = { ts: [], vals: [], labels: tags };
        }
        seriesMap[key].ts.push(ts);
        seriesMap[key].vals.push(val);
        seen++;
      } else {
        const tags: Labels = asTags(d) ?? {};
        const ts = Number(d.timestamp ?? Date.now());
        const tsNs = String(d.timestamp_ns ?? tags['chq_tsns'] ?? ts * 1_000_000);
        const body = String(asBody(d, tags));
        const level = String(tags['level'] ?? '');
        // chq_fingerprint is a similarity/clustering key, not unique per row, so it
        // can't be the Grafana row id. The data has no unique id column; chq_tsns is
        // unique per row, paired with the row index to stay collision-proof in a frame.
        const fp = String(tags['chq_fingerprint'] ?? '');
        const base = baseLogLabelsFrom(tags, target);
        if (timestamps.length < MAX_INITIAL) {
          timestamps.push(ts);
          // Extract sub-millisecond nanosecond offset (0-999999) for Grafana's nanos field
          const nanos = Number(BigInt(tsNs) % BigInt(1_000_000));
          nanosArr.push(nanos);
          bodies.push(body);
          severities.push(level);
          ids.push(`${tsNs}_${ids.length}`);
          labelsArr.push(base);
          fingerprints.push(fp);
        }
        seen++;
      }

      if (shouldEmit()) {
        const batch: DataFrame[] = [];
        if (Object.keys(seriesMap).length) {
          flushSeriesInto(batch);
        }
        if (!isVolume && timestamps.length > 0) {
          batch.push(buildLogsFrame());
        }
        if (batch.length && emit) {
          emit(batch);
          didEmit();
        }
      }
    }
  }

  if (Object.keys(seriesMap).length) {
    flushSeriesInto(frames);
  }
  if (!isVolume && timestamps.length > 0) {
    frames.push(buildLogsFrame());
  }
  if (emit && frames.length) {
    emit(frames);
  }
  return frames;
}

function getIntervalForTimeRange(start: number, end: number): string {
  const oneHourish = 1 * 65 * 60 * 1000;
  const twelveHours = 12 * 60 * 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  const threeDays = 3 * 24 * 60 * 60 * 1000;

  const diff = end - start;
  if (diff <= oneHourish) {
    return '10s';
  }
  if (diff <= twelveHours) {
    return '1m';
  }
  if (diff <= oneDay) {
    return '5m';
  }
  if (diff <= threeDays) {
    return '20m';
  }
  return '1h';
}
