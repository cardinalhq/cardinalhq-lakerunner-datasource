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
}): Promise<string[]> {
  const keys = new Set<string>();
  const path = `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}`;

  const resolvedMetricName = metricName ? replaceVar(metricName) : undefined;
  const metricNameUsable = !!resolvedMetricName && !isUnresolved(resolvedMetricName);
  const safeFilters = (filters ?? []).map(normalizeFilterForOptions).filter((f): f is Filter => !!f);
  const nestedFilter = buildNestedFilter(safeFilters);

  let filter: any;
  if (mode === 'metrics') {
    const parts: Record<string, any> = {};
    let i = 1;

    if (metricNameUsable) {
      parts[`q${i++}`] = {
        k: '_cardinalhq.name',
        v: [resolvedMetricName],
        op: 'eq',
        dataType: 'string',
        extracted: false,
        computed: false,
      };
    }
    if (nestedFilter) {
      parts[`q${i++}`] = nestedFilter;
    }

    filter = Object.keys(parts).length > 1 ? { ...parts, op: 'and' } : Object.values(parts)[0];
    if (!filter) {
      filter = {
        k: '_cardinalhq.name',
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      };
    }
  } else {
    filter =
      nestedFilter ??
      ({
        k: '_cardinalhq.name',
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      } as any);
  }

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
        if (onData) {
          onData(Array.from(keys));
        }
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
}): Promise<string[]> {
  if (!labelName) {
    throw new Error('labelName is required');
  }

  const resolvedLabel = replaceVar(labelName);
  if (!resolvedLabel || isUnresolved(resolvedLabel)) {
    return [];
  }
  const internalLabel = toInternalLabel(resolvedLabel);

  const vals = new Set<string>();
  const path = `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}&tagName=${encodeURIComponent(
    internalLabel
  )}&dataType=string`;

  const resolvedMetricName = metricName ? replaceVar(metricName) : undefined;
  const metricNameUsable = !!resolvedMetricName && !isUnresolved(resolvedMetricName);
  const safeFilters = (filters ?? []).map(normalizeFilterForOptions).filter((f): f is Filter => !!f);
  const nestedFilter = buildNestedFilter(safeFilters);

  let filter: any;
  if (mode === 'metrics') {
    const parts: Record<string, any> = {};
    let i = 1;

    if (metricNameUsable) {
      parts[`q${i++}`] = {
        k: '_cardinalhq.name',
        v: [resolvedMetricName],
        op: 'eq',
        dataType: 'string',
        extracted: false,
        computed: false,
      };
    }
    if (nestedFilter) {
      parts[`q${i++}`] = nestedFilter;
    }

    filter = Object.keys(parts).length > 1 ? { ...parts, op: 'and' } : Object.values(parts)[0];
    if (!filter) {
      filter = {
        k: '_cardinalhq.name',
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      };
    }
  } else {
    filter =
      nestedFilter ??
      ({
        k: internalLabel,
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      } as any);
  }

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

  await streamJsonCollect(
    datasourceId,
    path,
    body,
    (msg) => {
      const value = msg?.[internalLabel];
      if (value !== undefined && value !== null) {
        vals.add(String(value));
        if (onData) {
          onData(Array.from(vals));
        }
      }
    },
    signal,
    setIsWaiting
  );

  return Array.from(vals);
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
}): Promise<Array<{ metricName: string; metricType: 'gauge' }>> {
  const metrics = new Set<string>();
  const path = `/api/v1/tags/metrics?s=${startTime}&e=${endTime}&tagName=_cardinalhq.name&dataType=string`;

  await streamJsonCollect(
    datasourceId,
    path,
    undefined,
    (msg) => {
      const name = msg?.['_cardinalhq.name'];
      if (name) {
        metrics.add(name);
      }
    },
    signal,
    setIsWaiting
  );

  return Array.from(metrics).map((metricName) => ({
    metricName,
    metricType: 'gauge',
  }));
}
