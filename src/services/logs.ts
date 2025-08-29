import { getTemplateSrv } from '@grafana/runtime';
import { Filter, TEXT_OPERATORS } from '../types';
import { buildNestedFilter } from '../util/buildNestedFilter';
import { apiFetchEventSourceWrapper, EventSourceOptions } from '../util/QueryUtils';

const USER_LABEL_TO_INTERNAL: Record<string, string> = {
  message: '_cardinalhq.message',
  level: '_cardinalhq.level',
};

const INTERNAL_LABEL_TO_USER: Record<string, string> = {
  '_cardinalhq.message': 'message',
  '_cardinalhq.level': 'level',
};

export function toInternalLabel(label: string): string {
  return USER_LABEL_TO_INTERNAL[label] || label;
}

export function toUserLabel(label: string): string {
  return INTERNAL_LABEL_TO_USER[label] || label;
}

async function streamJsonCollect(
  datasourceId: number,
  path: string,
  body: any,
  onData: (msg: any) => void,
  signal?: AbortSignal,
  setIsWaiting?: (isWaiting: boolean) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = `/api/datasources/${datasourceId}/resources/proxy-stream`;

    const opts: EventSourceOptions = {
      method: 'POST',
      body: JSON.stringify({ path, body }),
      headers: { 'Content-Type': 'application/json' },
      signal,
      openWhenHidden: true,
      onmessage(e) {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.type === 'waiting_scale_up') {
            setIsWaiting?.(true);
            return;
          }
          if (parsed.type === 'done') {
            setIsWaiting?.(false);
            resolve();
            return;
          }
          if (parsed.type === 'data' && parsed.message) {
            onData(parsed.message);
          }
        } catch (err) {
          reject(err);
        }
      },
      onerror(err) {
        reject(err);
      },
    };

    apiFetchEventSourceWrapper(url, opts);
  });
}

const tsrv = getTemplateSrv();
const isUnresolved = (s?: string) => !!s && s.includes('$');
const replaceVar = (s?: string, fmt?: 'csv' | 'regex') =>
  s == null ? s : (tsrv.replace(s, undefined as any, fmt) as string);

function normalizeFilterForOptions(f: Filter): Filter | null {
  const tag = replaceVar(f.tag);
  if (!tag || isUnresolved(tag)) {
    return null;
  }

  const isTextOrRegex = TEXT_OPERATORS.includes(f.op as any) || f.op === 'regex' || f.op === 'not regex';
  const fmt: 'csv' | 'regex' = isTextOrRegex ? 'regex' : 'csv';

  const vals: string[] = [];
  for (const raw of f.value ?? []) {
    const rep = replaceVar(raw, fmt) ?? '';
    if (!rep || isUnresolved(rep)) {
      continue;
    }
    if (fmt === 'csv') {
      rep
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((v) => vals.push(v));
    } else {
      vals.push(rep);
    }
  }

  if (!isTextOrRegex && vals.length === 0) {
    return null;
  }

  return { ...f, tag, value: vals };
}

export async function fetchTagKeys({
  datasourceId,
  mode = 'logs',
  useRelativeTime = false,
  startTime,
  endTime,
  filters = [],
  metricName,
  metricType,
  signal,
  setIsWaiting,
  onData,
  extract,
}: {
  datasourceId: number;
  mode?: 'logs' | 'metrics' | 'promQL' | 'traces';
  useRelativeTime?: boolean;
  startTime?: number;
  endTime?: number;
  filters?: Filter[];
  metricName?: string;
  metricType?: string;
  signal?: AbortSignal;
  setIsWaiting?: (isWaiting: boolean) => void;
  onData?: (data: string[]) => void;

  extract?: {
    regex: string;
    fields: Array<{ name: string; type: 'string' | 'number' }>;
  };
}): Promise<string[]> {
  const keys = new Set<string>();
  const path = `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}`;

  const resolvedMetricName = metricName ? replaceVar(metricName) : undefined;
  const metricNameUsable = !!resolvedMetricName && !isUnresolved(resolvedMetricName);
  const safeFilters = (filters ?? []).map(normalizeFilterForOptions).filter((f): f is Filter => !!f);
  const nestedFilter = buildNestedFilter(safeFilters, extract);

  const andParts: Record<string, any> = {};
  let qi = 1;

  if (mode === 'metrics' && metricNameUsable) {
    andParts[`q${qi++}`] = {
      k: '_cardinalhq.name',
      v: [resolvedMetricName],
      op: 'eq',
      dataType: 'string',
      extracted: false,
      computed: false,
    };
  }

  if (nestedFilter) {
    andParts[`q${qi++}`] = nestedFilter;
  } else {
    andParts[`q${qi++}`] = {
      k: '_cardinalhq.name',
      v: [''],
      op: 'has',
      dataType: 'string',
      extracted: false,
      computed: false,
    };
  }
  const extractedFieldNames = extract?.fields?.map((f) => f.name).filter((n) => n && !/^var_/.test(n)) ?? [];

  for (const name of extractedFieldNames) {
    andParts[`q${qi++}`] = {
      k: name,
      v: [''],
      op: 'has',
      dataType: 'string',
      extracted: true,
      computed: false,
    };
  }

  const filter = Object.keys(andParts).length > 1 ? { ...andParts, op: 'and' } : Object.values(andParts)[0];

  const body: Record<string, any> = {
    dataset: mode,
    limit: 1000,
    order: 'DESC',
    returnResults: true,
    filter,
  };

  if (mode === 'metrics' && metricType) {
    body.metricType = metricType;
  }

  if (extract?.regex && extract.fields?.length) {
    body.extract = {
      regex: extract.regex,
      fields: extract.fields.map(({ name, type }) => ({ name, type })),
    };
  }

  await streamJsonCollect(
    datasourceId,
    path,
    body,
    (msg) => {
      if (msg && typeof msg === 'object') {
        Object.keys(msg).forEach((k) => {
          if (k === '_cardinalhq.level' || k === '_cardinalhq.message') {
            keys.add(toUserLabel(k));
          } else if (!k.startsWith('_cardinalhq.')) {
            keys.add(k);
          }
        });
        onData?.(Array.from(keys));
      }
    },
    signal,
    setIsWaiting
  );

  return Array.from(keys);
}

export async function fetchTagValues({
  datasourceId,
  mode = 'logs',
  metricName,
  metricType,
  labelName,
  filters = [],
  signal,
  startTime,
  endTime,
  setIsWaiting,
  onData,
  extract,
}: {
  datasourceId: number;
  mode?: 'logs' | 'metrics' | 'promQL' | 'traces';
  metricName?: string;
  metricType?: string;
  labelName: string;
  filters?: Filter[];
  useRelativeTime?: boolean;
  signal?: AbortSignal;
  startTime?: number;
  endTime?: number;
  setIsWaiting?: (isWaiting: boolean) => void;
  onData?: (data: string[]) => void;
  extract?: {
    regex: string;
    fields: Array<{ name: string; type: 'string' | 'number' }>;
  };
}): Promise<string[]> {
  if (!labelName) {
    throw new Error('labelName is required');
  }

  const resolvedLabel = replaceVar(labelName);
  if (!resolvedLabel || isUnresolved(resolvedLabel)) {
    return [];
  }

  const internalLabel = toInternalLabel(resolvedLabel);

  const fieldForLabel = extract?.fields?.find(
    (f) => toInternalLabel(f.name) === internalLabel || f.name === resolvedLabel
  );
  const isExtractedLabel = !!fieldForLabel;
  const labelDataType = fieldForLabel?.type ?? 'string';

  const path =
    `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}` +
    `&tagName=${encodeURIComponent(internalLabel)}` +
    `&dataType=${encodeURIComponent(labelDataType)}`;

  const vals = new Set<string>();

  const resolvedMetricName = metricName ? replaceVar(metricName) : undefined;
  const metricNameUsable = !!resolvedMetricName && !isUnresolved(resolvedMetricName);

  const safeFilters = (filters ?? []).map(normalizeFilterForOptions).filter((f): f is Filter => !!f);
  const nestedFilter = buildNestedFilter(safeFilters, extract); // pass extract so leaves can be marked

  const andParts: Record<string, any> = {};
  let qi = 1;

  if (mode === 'metrics' && metricNameUsable) {
    andParts[`q${qi++}`] = {
      k: '_cardinalhq.name',
      v: [resolvedMetricName],
      op: 'eq',
      dataType: 'string',
      extracted: false,
      computed: false,
    };
  }

  if (nestedFilter) {
    andParts[`q${qi++}`] = nestedFilter;
  }
  andParts[`q${qi++}`] = {
    k: internalLabel,
    v: [''],
    op: 'has',
    dataType: labelDataType,
    extracted: isExtractedLabel,
    computed: false,
  };

  const filter = Object.keys(andParts).length > 1 ? { ...andParts, op: 'and' } : Object.values(andParts)[0];

  const body: Record<string, any> = {
    dataset: mode,
    filter,
    limit: 1000,
    order: 'DESC',
    returnResults: true,
  };
  if (mode === 'metrics' && metricType) {
    body.metricType = metricType;
  }
  if (extract?.regex && extract.fields?.length) {
    body.extract = {
      regex: extract.regex,
      fields: extract.fields.map(({ name, type }) => ({ name, type })),
    };
  }

  await streamJsonCollect(
    datasourceId,
    path,
    body,
    (msg) => {
      const value = msg?.[internalLabel];
      if (value !== undefined && value !== null) {
        vals.add(String(value));
        onData?.(Array.from(vals));
      }
    },
    signal,
    setIsWaiting
  );

  return Array.from(vals);
}

type MetricKind = 'gauge' | 'sum' | 'histogram' | 'counter' | 'summary';

const normalizeKind = (raw: any): MetricKind => {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'gauge') {
    return 'gauge';
  }
  if (v === 'sum' || v === 'counter') {
    return v as MetricKind;
  }
  if (v === 'histogram') {
    return 'histogram';
  }
  if (v === 'summary') {
    return 'summary';
  }
  return 'gauge';
};

async function fetchJsonOnce<T = any>(datasourceId: number, path: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(`/api/datasources/${datasourceId}/resources/proxy-query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal,
  });
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as T;
}

function inferKindFromName(name: string): MetricKind {
  const n = String(name).toLowerCase();
  if (n.endsWith('_total')) {
    return 'counter';
  }
  return 'gauge';
}

export async function fetchMetricNames({
  datasourceId,
  startTime,
  endTime,
  signal,
  setIsWaiting,
}: {
  datasourceId: number;
  startTime?: number;
  endTime?: number;
  signal?: AbortSignal;
  setIsWaiting?: (isWaiting: boolean) => void;
}): Promise<Array<{ metricName: string; metricType: MetricKind }>> {
  const seen = new Map<string, { metricName: string; metricType: MetricKind }>();

  const parseMetadata = (data: any) => {
    if (Array.isArray(data)) {
      return data;
    }
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
      return data.items;
    }
    return [];
  };

  const streamPath = `/api/v1/tags/metrics?s=${startTime}&e=${endTime}&tagName=_cardinalhq.name&dataType=string`;

  const streamNames = async (): Promise<Set<string>> => {
    const names = new Set<string>();
    await streamJsonCollect(
      datasourceId,
      streamPath,
      undefined,
      (msg) => {
        const name = msg?.['_cardinalhq.name'];
        if (name) {
          names.add(String(name));
        }
      },
      signal,
      setIsWaiting
    );
    return names;
  };

  try {
    setIsWaiting?.(true);

    const [metaRes, streamRes] = await Promise.allSettled([
      fetchJsonOnce<any>(datasourceId, `/api/v1/metricMetadata`, signal),
      streamNames(),
    ]);

    if (metaRes.status === 'fulfilled' && metaRes.value) {
      for (const m of parseMetadata(metaRes.value)) {
        const name = m?.metricName;
        if (!name || seen.has(name)) {
          continue;
        }
        seen.set(String(name), {
          metricName: String(name),
          metricType: normalizeKind(m?.metricType),
        });
      }
    }

    if (streamRes.status === 'fulfilled') {
      for (const name of streamRes.value) {
        if (!seen.has(name)) {
          seen.set(name, { metricName: name, metricType: inferKindFromName(name) });
        }
      }
    }

    return [...seen.values()].sort((a, b) => a.metricName.localeCompare(b.metricName));
  } finally {
    setIsWaiting?.(false);
  }
}
