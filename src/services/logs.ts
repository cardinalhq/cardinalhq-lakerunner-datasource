import { Filter } from '../types';
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
  signal?: AbortSignal
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
          if (parsed.type === 'data' && parsed.message) {
            onData(parsed.message);
          } else if (parsed.type === 'done') {
            resolve();
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

export async function fetchTagKeys({
  datasourceId,
  mode = 'logs',
  useRelativeTime = false,
  startTime,
  endTime,
  filters = [],
  signal,
}: {
  datasourceId: number;
  mode?: 'logs' | 'metrics';
  useRelativeTime?: boolean;
  startTime?: number;
  endTime?: number;
  filters?: Filter[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const keys = new Set<string>();
  const path = `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}`;
  const nestedFilter = buildNestedFilter(filters);
  const fallbackFilter =
    mode === 'logs'
      ? {
          k: '_cardinalhq.name',
          v: [''],
          op: 'has',
          dataType: 'string',
          extracted: false,
          computed: false,
        }
      : undefined;

  const filter = nestedFilter ?? fallbackFilter;

  const body =
    !useRelativeTime && filter
      ? {
          mode,
          filter,
          limit: 1000,
          order: 'DESC',
          returnResults: true,
        }
      : undefined;

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
      }
    },
    signal
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
}: {
  datasourceId: number;
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
  labelName: string;
  filters?: Filter[];
  useRelativeTime?: boolean;
  signal?: AbortSignal;
  startTime?: number;
  endTime?: number;
}): Promise<string[]> {
  if (!labelName) {
    throw new Error('labelName is required');
  }
  const vals = new Set<string>();

  const internalLabel = toInternalLabel(labelName);

  const path = `/api/v1/tags/${mode}?s=${startTime}&e=${endTime}&tagName=${encodeURIComponent(
    internalLabel
  )}&dataType=string`;

  const nestedFilter = buildNestedFilter(filters);

  const metricNameFilter =
    mode === 'metrics' && metricName
      ? {
          k: '_cardinalhq.name',
          v: [metricName],
          op: 'eq',
          dataType: 'string',
          extracted: false,
          computed: false,
        }
      : undefined;

  let filter;

  if (mode === 'metrics') {
    const filterEntries: Record<string, any> = {};
    let i = 1;

    if (metricNameFilter) {
      filterEntries[`q${i++}`] = metricNameFilter;
    }
    if (nestedFilter) {
      filterEntries[`q${i++}`] = nestedFilter;
    }

    filter = Object.keys(filterEntries).length > 1 ? { ...filterEntries, op: 'and' } : Object.values(filterEntries)[0];

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
    filter = nestedFilter ?? {
      k: internalLabel,
      v: [''],
      op: 'has',
      dataType: 'string',
      extracted: false,
      computed: false,
    };
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
      }
    },
    signal
  );

  return Array.from(vals);
}

export async function fetchMetricNames({
  datasourceId,
  startTime,
  endTime,
  signal,
}: {
  datasourceId: number;
  startTime?: number;
  endTime?: number;
  signal?: AbortSignal;
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
    signal
  );

  return Array.from(metrics).map((metricName) => ({
    metricName,
    metricType: 'gauge',
  }));
}
