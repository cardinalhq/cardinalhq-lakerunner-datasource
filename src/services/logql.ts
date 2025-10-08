import { DataFrame, DataQueryRequest, DataFrameType, FieldType, toDataFrame } from '@grafana/data';
import { withHiddenFingerprint } from '../util/buildFinalLogQL';
import { buildLogQLPlans } from 'util/LogqlBuilder';

const norm = (t: string) => t.replace(/\./g, '_');
const LEVEL_INTERNAL = norm('log_level');

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
  const want = [LEVEL_INTERNAL];
  const next = Array.from(new Set([...byList, ...want]));
  return `${agg} by (${next.join(',')})(${m[3]})`;
}
const DEFAULT_SELECTOR = '{resource_service_name=~".+"}';

function ensureStreamSelector(expr: string): string {
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

const getSelectedExtractLabel = (target: any): string | undefined => {
  const sel = target?.extractor?.selections?.find((s: any) => s?.selected)?.label;
  if (sel) {
    return sel;
  }
  if (Array.isArray(target?.extractor?.selections) && target.extractor.selections.length === 1) {
    return target.extractor.selections[0]?.label;
  }
  return undefined;
};

const toRegex = (pattern: string | undefined): RegExp | null => {
  if (!pattern || typeof pattern !== 'string') {
    return null;
  }
  try {
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const last = pattern.lastIndexOf('/');
      return new RegExp(pattern.slice(1, last), pattern.slice(last + 1));
    }
    return new RegExp(pattern);
  } catch {
    return null;
  }
};

const extractFromBody = (body: string, target: any): Record<string, string> => {
  const out: Record<string, string> = {};
  const rx = toRegex(target?.extractor?.regex);
  if (!rx) {
    return out;
  }
  const m = rx.exec(body ?? '');
  if (!m) {
    return out;
  }
  if ((m as any).groups) {
    for (const [k, v] of Object.entries((m as any).groups)) {
      out[k] = String(v ?? '');
    }
    return out;
  }
  const fields = Array.isArray(target?.extractor?.fields) ? target.extractor.fields : [];
  for (let i = 0; i < fields.length; i++) {
    const label = fields[i]?.label;
    if (!label) {
      continue;
    }
    const val = m[i + 1];
    if (val != null) {
      out[label] = String(val);
    }
  }
  return out;
};

const baseLogLabelsFrom = (tags: Labels, target?: any): Labels => {
  const out: Labels = {};

  for (const [k, v] of Object.entries(tags || {})) {
    if (k.startsWith('chq') || k.startsWith('_cardinalhq_')) {
      continue;
    }
    if (k === '__extracted_struct') {
      continue;
    }
    out[k] = v;
  }

  const extractedStruct = tags['__extracted_struct'];
  if (extractedStruct && typeof extractedStruct === 'object') {
    const extractorFields = target?.extractor?.fields || [];

    for (const [varKey, value] of Object.entries(extractedStruct)) {
      if (varKey.startsWith('__var_')) {
        const varIndex = parseInt(varKey.replace('__var_', ''), 10);
        const fieldDef = extractorFields[varIndex];
        if (fieldDef && fieldDef.label) {
          out[fieldDef.label] = value;
        }
      } else {
        out[varKey] = value;
      }
    }
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
  datasourceId: number,
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
  const shouldApplyFingerprint = !target.logqlEdited;
  const expr = shouldApplyFingerprint ? withHiddenFingerprint(chosen, target.selectedFingerprint) : chosen;
  const s = String(startMs);
  const e = String(endMs);

  const body: any = { q: expr, s, e, reverse: true, limit: 1000 };
  const fields = target.logqlSubTab === 'builder' ? target.builderFields : target.codeFields;
  if (Array.isArray(fields) && fields.length > 0) {
    body.fields = fields;
  }

  const res = await fetch(`/api/datasources/${datasourceId}/resources/proxy-promql`, {
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

  const seriesMap: Record<string, { ts: number[]; vals: number[]; labels?: Labels; display?: string }> = {};
  const timestamps: number[] = [];
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
      const lvlRaw = lab['log_level'] ?? lab['level'];
      const levelStr = lvlRaw ? String(lvlRaw) : undefined;
      const fixedColor = levelStr ? levelColors[levelStr.toLowerCase()] : undefined;
      const display = s.display ?? name;
      const pretty = prettyLabel(display);
      const fieldLabels = levelStr ? { ...lab, level: levelStr, detected_level: levelStr } : lab;
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
              displayNameFromDS: levelStr ? `{detected_level="${levelStr}", level="${levelStr}"}` : pretty,
              ...(fixedColor ? { color: { mode: 'fixed', fixedColor } } : { color: { mode: 'palette-classic' } }),
            },
          },
        ],
      });
      (frame.meta as any) = { preferredVisualisationType: 'graph' };
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

    const MSG_TAGS = new Set(['message', 'log_message']);

    for (const f of Array.isArray(tgt?.filters) ? tgt.filters : []) {
      const tag = String(f?.tag ?? '');
      if (!MSG_TAGS.has(tag)) {
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
    const f = toDataFrame({
      refId: target.refId,
      name: 'logs',
      fields: [
        { name: 'timestamp', type: FieldType.time, values: timestamps.slice() },
        { name: 'body', type: FieldType.string, values: bodies.slice() },
        { name: 'severity', type: FieldType.string, values: severities.slice() },
        { name: 'id', type: FieldType.string, values: ids.slice() },
        { name: 'labels', type: FieldType.other, values: labelsArr.slice() },
        { name: 'fingerprint', type: FieldType.string, values: fingerprints.slice() },
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
    d?.body ?? d?.line ?? tags['log_message'] ?? tags['log.message'] ?? tags['message'] ?? '';
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
          !('log_message' in (t || {})) &&
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
  const didEmit = () => (lastEmit = performance.now());

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
      if (payload.type !== 'result' || !payload.data) {
        continue;
      }

      const d = payload.data;

      if (looksLikeVolumePoint(d)) {
        const ts = Number(d.timestamp);
        const val = Number(d.value);
        const tags: Labels = asTags(d) ?? {};
        const levelVal = tags['log_level'] ?? tags['log_level'] ?? tags['level'];
        const key =
          d.key ||
          (levelVal != null
            ? `log_level=${levelVal}`
            : Object.entries(tags)
                .filter(([k]) => k !== 'name')
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => `${k}=${v}`)
                .join(', ') || 'series');
        if (!seriesMap[key]) {
          const display = levelVal != null ? `level=${levelVal}` : d.label || key;
          seriesMap[key] = { ts: [], vals: [], labels: tags, display };
        }
        seriesMap[key].ts.push(ts);
        seriesMap[key].vals.push(val);
        seen++;
      } else {
        const tags: Labels = asTags(d) ?? {};
        const ts = Number(d.timestamp ?? Date.now());
        const body = String(asBody(d, tags));
        const level = String(tags['log_level'] ?? tags['level'] ?? '');
        const id = String(tags['chq_id'] ?? tags['id'] ?? '');
        const fp = String(tags['chq_fingerprint'] ?? tags['chq_id'] ?? tags['id'] ?? '');
        const base = baseLogLabelsFrom(tags, target);
        const sel = getSelectedExtractLabel(target);
        if (sel) {
          const extracted = extractFromBody(body, target);
          if (Object.prototype.hasOwnProperty.call(extracted, sel)) {
            base[sel] = extracted[sel];
          }
        }
        if (timestamps.length < MAX_INITIAL) {
          timestamps.push(ts);
          bodies.push(body);
          severities.push(level);
          ids.push(id);
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
