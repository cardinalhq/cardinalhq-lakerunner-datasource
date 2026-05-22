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

import { DataFrame, FieldType, toDataFrame, DataQueryRequest } from '@grafana/data';
import { Filter, MyQuery } from '../types';
import { buildLogQLPlans } from 'util/LogqlBuilder';

const DEFAULT_SELECTOR = '{service_name=~".+"}';
const ensureStreamSelector = (expr: string): string => {
  const trimmed = (expr ?? '').trim();
  if (!trimmed) {
    return DEFAULT_SELECTOR;
  }
  const hasAnySelector = /\{[^}]*\}/.test(trimmed);
  const hasNonEmptySelector = /\{[^}]*[A-Za-z_][\w.\-]*\s*(?:=|=~|!=|!~)\s*"(?:[^"\\]|\\.)*"[^}]*\}/.test(trimmed);
  if (trimmed.startsWith('|')) {
    return `${DEFAULT_SELECTOR} ${trimmed}`;
  }
  if (hasAnySelector && hasNonEmptySelector) {
    return trimmed;
  }
  if (hasAnySelector && !hasNonEmptySelector) {
    return trimmed.replace(/\{\s*\}/g, DEFAULT_SELECTOR);
  }
  const firstPipe = trimmed.indexOf('|');
  if (firstPipe > -1) {
    return `${DEFAULT_SELECTOR} ${trimmed.slice(firstPipe)}`;
  }
  return `${DEFAULT_SELECTOR} ${trimmed}`;
};

const buildFilterExpr = (target: MyQuery, intervalToken: string): string => {
  const plans = buildLogQLPlans(
    { filters: target.filters, valueAs: undefined, logqlAggregation: undefined, groupBy: [], extractor: undefined },
    intervalToken
  );
  const filterPlan = plans.find((p) => p.role === 'filter');
  return filterPlan?.expr ?? '{}';
};

const isInternal = (k: string) => k.startsWith('_cardinalhq');
const toKVs = (obj: Record<string, any>) => Object.entries(obj ?? {}).map(([key, value]) => ({ key, value }));

type SpanEvent = { timestamp: number; name: string; fields: Array<{ key: string; value: any }> };

export const getTraceId = (tags: Record<string, any>): string => String(tags['trace_id'] ?? '');
export const getSpanId = (tags: Record<string, any>): string => String(tags['id'] ?? '');
export const getParentSpanId = (tags: Record<string, any>): string => String(tags['parent_span_id'] ?? '');
export const getStartTs = (tags: Record<string, any>, fallbackTs: number): number =>
  Number(tags['start_timestamp'] ?? fallbackTs);
export const getDurationMs = (tags: Record<string, any>): number => {
  const raw = tags['duration'];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1;
};
export const getServiceName = (tags: Record<string, any>): string => String(tags['service_name'] ?? '');
export const getOperationName = (tags: Record<string, any>): string =>
  String(tags['name'] ?? tags['_cardinalhq_name'] ?? '');

export const getSelectedTraceId = (filters: Filter[]) =>
  filters.find(
    (f) =>
      f.tag === 'trace_id' &&
      f.op === '=' &&
      Array.isArray(f.value) &&
      f.value.length === 1 &&
      String(f.value[0]).trim() !== ''
  )?.value?.[0];

const getSpanEvents = (tags: Record<string, any>): SpanEvent[] => {
  const raw = tags['events'];
  let events: any[] = [];
  if (raw) {
    try {
      events = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    } catch {
      events = [];
    }
  }
  return events
    .map((e) => {
      const tsRaw = e?.timestamp;
      const ts = Number(tsRaw);
      const attrs = e?.attributes ?? {};
      const hasAny =
        attrs['exception.type'] != null || attrs['exception.message'] != null || attrs['exception.stacktrace'] != null;
      if (!hasAny || !Number.isFinite(ts)) {
        return null;
      }
      const fields: Array<{ key: string; value: any }> = [];
      if (attrs['exception.type'] != null) {
        fields.push({ key: 'exception.type', value: attrs['exception.type'] });
      }
      if (attrs['exception.message'] != null) {
        fields.push({ key: 'exception.message', value: attrs['exception.message'] });
      }
      if (attrs['exception.stacktrace'] != null) {
        fields.push({ key: 'exception.stacktrace', value: attrs['exception.stacktrace'] });
      }
      return { timestamp: ts, name: e?.name ?? 'exception', fields } as SpanEvent;
    })
    .filter((ev): ev is SpanEvent => !!ev);
};

function buildTraceTableFrame(
  refId: string,
  timestamps: number[],
  labelsArr: Array<Record<string, any>>,
  instanceSettings: { uid: string; name: string }
) {
  const traceID: string[] = [];
  const spanID: string[] = [];
  const parentSpanID: string[] = [];
  const service: string[] = [];
  const timestamp: number[] = [];
  const duration: number[] = [];
  const name: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const tags = labelsArr[i] ?? {};
    const tid = getTraceId(tags);
    if (!tid) {
      continue;
    }
    traceID.push(tid);
    spanID.push(getSpanId(tags));
    parentSpanID.push(getParentSpanId(tags));
    service.push(getServiceName(tags));
    timestamp.push(getStartTs(tags, Number(timestamps[i])));
    duration.push(getDurationMs(tags));
    name.push(getOperationName(tags));
  }
  const frame = toDataFrame({
    refId,
    name: 'Traces',
    fields: [
      {
        name: 'spanID',
        type: FieldType.string,
        values: spanID,
        config: {
          displayName: 'Span ID',
          links: [
            {
              title: 'View trace for span ${__value.raw}',
              url: '',
              internal: {
                datasourceUid: instanceSettings.uid,
                datasourceName: instanceSettings.name,
                query: {
                  refId: 'A',
                  mode: 'traces',
                  queryType: 'traceql',
                  filters: [{ tag: 'trace_id', op: '=', value: ['${__data.fields.traceID}'] }],
                  groupBy: [],
                },
                panelsState: { trace: { spanId: '${__value.raw}' } },
              },
            },
          ],
        },
      },
      {
        name: 'service',
        type: FieldType.string,
        values: service,
        config: { displayName: 'Service Name', align: 'center', minWidth: 140 },
      },
      { name: 'name', type: FieldType.string, values: name, config: { displayName: 'Span Name' } },
      { name: 'timestamp', type: FieldType.time, values: timestamp, config: { displayName: 'Start Time' } },
      {
        name: 'durationMs',
        type: FieldType.number,
        values: duration,
        config: { displayName: 'Duration', unit: 'ms', decimals: 0, custom: { align: 'right' } },
      },
      { name: 'traceID', type: FieldType.string, values: traceID, config: { displayName: 'Trace ID' } },
    ],
  });
  (frame.meta as any) = { preferredVisualisationType: 'table' };
  return frame;
}

function getHasError(tags: Record<string, any>): boolean {
  const v = tags['status_code'];

  if (v == null) {
    return false;
  }
  const s = String(v).trim().toLowerCase();
  return s === 'error' || s === '2' || s === 'true' || s === '1' || v === true;
}

function buildTraceWaterfallFrame(
  refId: string,
  timestamps: number[],
  labelsArr: Array<Record<string, any>>,
  selectedTraceId?: string
) {
  const traceID: string[] = [];
  const spanID: string[] = [];
  const parentSpanID: string[] = [];
  const serviceName: string[] = [];
  const operationName: string[] = [];
  const startTime: number[] = [];
  const duration: number[] = [];
  const tagsCol: Array<Array<{ key: string; value: any }>> = [];
  const serviceTagsCol: Array<Array<{ key: string; value: any }>> = [];
  const logsCol: Array<Array<{ timestamp: number; name?: string; fields: Array<{ key: string; value: any }> }>> = [];
  const refsCol: Array<Array<{ traceID: string; spanID: string; tags?: Array<{ key: string; value: any }> }>> = [];
  const statusCodeCol: number[] = [];
  const statusMsgCol: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const tags = labelsArr[i] ?? {};
    const tid = getTraceId(tags);
    if (selectedTraceId && tid !== selectedTraceId) {
      continue;
    }
    const ts = getStartTs(tags, Number(timestamps[i]));
    const sId = getSpanId(tags);
    const pId = getParentSpanId(tags);
    const svc = getServiceName(tags);
    const op = getOperationName(tags);
    const durMs = getDurationMs(tags);
    const spanTags = toKVs(tags).filter(({ key }) => !isInternal(key));
    // With flat attribute names, resource vs span tags are no longer distinguishable.
    // Grafana's trace panel requires the serviceTags field, so we pass an empty array.
    const resourceTags: Array<{ key: string; value: any }> = [];
    let statusCode = 1;
    let statusMessage = '';
    if (getHasError(tags)) {
      spanTags.push({ key: 'status.code', value: 'ERROR' });
      statusCode = 2;
      statusMessage = tags['exception.message'] || 'Span marked as error';
    }
    traceID.push(tid);
    spanID.push(sId);
    parentSpanID.push(pId);
    serviceName.push(svc);
    operationName.push(op);
    startTime.push(ts);
    duration.push(durMs);
    tagsCol.push(spanTags);
    serviceTagsCol.push(resourceTags);
    logsCol.push(getSpanEvents(tags));
    refsCol.push([]);
    statusCodeCol.push(statusCode);
    statusMsgCol.push(statusMessage);
  }
  const fields: any[] = [
    { name: 'traceID', type: FieldType.string, values: traceID },
    { name: 'spanID', type: FieldType.string, values: spanID },
    { name: 'parentSpanID', type: FieldType.string, values: parentSpanID },
    { name: 'serviceName', type: FieldType.string, values: serviceName },
    { name: 'operationName', type: FieldType.string, values: operationName },
    { name: 'startTime', type: FieldType.number, values: startTime },
    { name: 'duration', type: FieldType.number, values: duration },
    { name: 'tags', type: FieldType.other, values: tagsCol },
    { name: 'serviceTags', type: FieldType.other, values: serviceTagsCol },
    { name: 'events', type: FieldType.other, values: logsCol },
    { name: 'logs', type: FieldType.other, values: logsCol },
    { name: 'references', type: FieldType.other, values: refsCol },
    { name: 'statusCode', type: FieldType.number, values: statusCodeCol },
    { name: 'statusMessage', type: FieldType.string, values: statusMsgCol },
  ];
  const frame = toDataFrame({ refId, name: 'Traces', fields });
  (frame.meta as any) = { preferredVisualisationType: 'trace', custom: { traceFormat: 'otlp' } };
  return frame;
}

type EmitFn = (frames: DataFrame[]) => void;

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
const looksAggregated = (expr: string) => AGG_FUNCS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`, 'i').test(expr));

const stripRangeVectorFromSelector = (expr: string): string => expr.replace(/(\{[^}]*\})\s*\[[^\]]+\]/g, '$1');

const unwrapOuterAggregation = (expr: string): string => {
  let s = expr.trim();
  const rx = /^\s*([a-zA-Z_][\w]*)\s*(?:by\s*\((?:[^)(]|\((?:[^)(]|\([^)(]*\))*\))*\))?\s*\(\s*([\s\S]+)\s*\)\s*$/;
  if (/^\s*\{[^}]*\}\s*(?:\||$)/.test(s)) {
    return s;
  }
  for (let i = 0; i < 6; i++) {
    const m = rx.exec(s);
    if (!m) {
      break;
    }
    s = m[2].trim();
    if (/^\s*\{[^}]*\}/.test(s) || s.startsWith('|')) {
      break;
    }
  }
  return s;
};

const extractInnerStream = (q: string, fallback: string): string => {
  const unwrapped = unwrapOuterAggregation(q);
  let inner = unwrapped && unwrapped !== q.trim() ? unwrapped : q;
  inner = stripRangeVectorFromSelector(inner);
  const firstPipe = inner.indexOf('|');
  if (firstPipe > -1) {
    return ensureStreamSelector(inner.slice(0, firstPipe).trim() + ' ' + inner.slice(firstPipe));
  }
  if (/\{[^}]*\}/.test(inner)) {
    return ensureStreamSelector(inner);
  }
  return ensureStreamSelector(fallback);
};

function looksTimeseriesResult(d: any): boolean {
  if (!d) {
    return false;
  }
  const ts = Number(d.timestamp);
  const val = toNumberValue(d.value);
  const label = d.label != null ? String(d.label) : '';
  if (Number.isFinite(ts) && Number.isFinite(val) && label.length > 0) {
    return true;
  }
  if (d.tags?.name === '__logql_logs_total' && Number.isFinite(ts) && Number.isFinite(val)) {
    return true;
  }
  return false;
}

async function streamSpans(
  datasourceUid: string,
  body: any,
  signal: AbortSignal,
  onTimeseries: (ts: number, val: number, label: string) => void,
  onRow: (ts: number, tags: Record<string, any>) => void
) {
  const res = await fetch(`/api/datasources/uid/${datasourceUid}/resources/proxy-promql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: `/api/v1/spans/query`, body }),
    signal,
  });
  if (!res.ok || !res.body) {
    let errDetail = '';
    try {
      errDetail = await res.text();
    } catch {}
    throw new Error(`Traces request failed http=${res.status}` + (errDetail ? `\n${errDetail}` : ''));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
      try {
        const payload = JSON.parse(line.slice(5).trim());
        if (payload?.type === 'timeseries' && payload.data) {
          const d = payload.data;
          const ts = Number(d.timestamp);
          const val = toNumberValue(d.value);
          const label = String(d.label ?? '');
          if (Number.isFinite(ts) && Number.isFinite(val) && label) {
            onTimeseries(ts, val, label);
          }
          continue;
        }
        if (payload?.type === 'result' && payload.data) {
          const d = payload.data;
          if (looksTimeseriesResult(d)) {
            const ts = Number(d.timestamp);
            const val = toNumberValue(d.value);
            const label = String(d.label ?? d.tags?.name ?? 'series');
            if (Number.isFinite(ts) && Number.isFinite(val) && label) {
              onTimeseries(ts, val, label);
            }
          } else {
            const tags: Record<string, any> = d?.tags ?? d?.labels ?? d?.attributes ?? {};
            const ts = Number(d?.timestamp ?? Date.now());
            onRow(ts, tags);
          }
        }
      } catch {}
    }
  }
}

export async function runTracesQuery(
  datasourceUid: string,
  instanceSettings: { uid: string; name: string },
  target: MyQuery,
  range: DataQueryRequest<MyQuery>['range'],
  signal: AbortSignal,
  emit?: EmitFn
): Promise<DataFrame[]> {
  const startMs = Number(range?.from?.valueOf?.() ?? Date.now() - 6 * 60 * 60 * 1000);
  const endMs = Number(range?.to?.valueOf?.() ?? Date.now());
  const selectedTraceId = getSelectedTraceId(target.filters ?? []);
  const isTraceDetail = Boolean(selectedTraceId);

  const exprFromUI = (target as any).tracesEdited ? (target as any).tracesOutput : (target as any).tracesBuilderExp;
  const qRaw = (exprFromUI ?? '').trim();
  const qPrimary = qRaw || buildFilterExpr(target, '__interval');
  const aggregated = looksAggregated(qPrimary);

  const timeseries: Record<string, { timestamps: number[]; values: number[] }> = {};
  const pushTS = (ts: number, val: number, label: string) => {
    if (!timeseries[label]) {
      timeseries[label] = { timestamps: [], values: [] };
    }
    timeseries[label].timestamps.push(ts);
    timeseries[label].values.push(val);
  };

  const timestamps: number[] = [];
  const labelsArr: Array<Record<string, any>> = [];
  const onRow = (ts: number, tags: Record<string, any>) => {
    if (timestamps.length < 1000) {
      timestamps.push(ts);
      labelsArr.push(tags);
    }
  };

  let seen = 0;
  let lastEmit = 0;
  const shouldEmit = () => !!emit && (seen % 50 === 0 || performance.now() - lastEmit > 250);
  const didEmit = () => (lastEmit = performance.now());

  const emitBatch = () => {
    if (!emit) {
      return;
    }
    const batch: DataFrame[] = [];
    for (const [label, series] of Object.entries(timeseries)) {
      const frame = toDataFrame({
        refId: target.refId,
        name: label,
        fields: [
          { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
          {
            name: 'Value',
            type: FieldType.number,
            values: series.values.slice(),
            config: { displayNameFromDS: label },
          },
        ],
      });
      (frame.meta as any) = { preferredVisualisationType: 'graph' };
      batch.push(frame);
    }
    if (timestamps.length) {
      const tbl = isTraceDetail
        ? buildTraceWaterfallFrame(target.refId, timestamps, labelsArr, selectedTraceId)
        : buildTraceTableFrame(target.refId, timestamps, labelsArr, instanceSettings);
      batch.push(tbl);
    }
    if (batch.length) {
      emit(batch);
    }
  };

  if (aggregated) {
    await streamSpans(
      datasourceUid,
      { q: qPrimary, s: String(startMs), e: String(endMs), reverse: true, limit: 1000 },
      signal,
      (ts, val, label) => {
        pushTS(ts, val, label);
        seen++;
        if (shouldEmit()) {
          emitBatch();
          didEmit();
        }
      },
      () => {}
    );
    const fallback = buildFilterExpr(target, '__interval');
    const qInner = extractInnerStream(qPrimary, fallback);
    await streamSpans(
      datasourceUid,
      { q: qInner, s: String(startMs), e: String(endMs), reverse: true, limit: 1000 },
      signal,
      () => {},
      (ts, tags) => {
        onRow(ts, tags);
        seen++;
        if (shouldEmit()) {
          emitBatch();
          didEmit();
        }
      }
    );
  } else {
    await streamSpans(
      datasourceUid,
      { q: ensureStreamSelector(qPrimary), s: String(startMs), e: String(endMs), reverse: true, limit: 1000 },
      signal,
      (ts, val, label) => {
        pushTS(ts, val, label);
        seen++;
        if (shouldEmit()) {
          emitBatch();
          didEmit();
        }
      },
      (ts, tags) => {
        onRow(ts, tags);
        seen++;
        if (shouldEmit()) {
          emitBatch();
          didEmit();
        }
      }
    );
  }

  const frames: DataFrame[] = [];
  for (const [label, series] of Object.entries(timeseries)) {
    const frame = toDataFrame({
      refId: target.refId,
      name: label,
      fields: [
        { name: 'Time', type: FieldType.time, values: series.timestamps.slice() },
        { name: 'Value', type: FieldType.number, values: series.values.slice(), config: { displayNameFromDS: label } },
      ],
    });
    (frame.meta as any) = { preferredVisualisationType: 'graph' };
    frames.push(frame);
  }
  const tableFrame = isTraceDetail
    ? buildTraceWaterfallFrame(target.refId, timestamps, labelsArr, selectedTraceId)
    : buildTraceTableFrame(target.refId, timestamps, labelsArr, instanceSettings);
  frames.push(tableFrame);

  if (emit && frames.length) {
    emit(frames);
  }
  return frames;
}
