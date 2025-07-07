import { Filter } from '../types';
import {
  apiFetchEventSourceWrapper,
  EventSourceOptions,
} from '../util/QueryUtils';
import { buildNestedFilter } from '../util/buildNestedFilter';

const BASE_URL = 'https://app.cardinalhq.io';
const API_KEY = 'REDACTED_API_KEY';

async function streamJsonCollect(
  url: string,
  body: any,
  headers: Record<string, string>,
  onData: (msg: any) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const opts: EventSourceOptions = {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
      signal,
      openWhenHidden: true,
      onmessage(e) {
        let parsed: any;
        try {
          parsed = JSON.parse(e.data);
        } catch (err) {
          return reject(err);
        }
        if (parsed.type === 'data' && parsed.message) {
          onData(parsed.message);
        } else if (parsed.type === 'done') {
          resolve();
        }
      },
      onerror(err) {
        reject(err);
      },
    };
    apiFetchEventSourceWrapper(url, opts);
  });
}

/**
 * Fetch tag keys for logs or metrics
 */
export async function fetchTagKeys({
  mode = 'logs',
  useRelativeTime = false,
  startTime,
  endTime,
  filters = [],
  signal,
}: {
  mode?: 'logs' | 'metrics';
  useRelativeTime?: boolean;
  startTime?: number;
  endTime?: number;
  filters?: Filter[];
  signal?: AbortSignal;
}): Promise<string[]> {
  const dataset = mode;
  const keys = new Set<string>();

  const url = useRelativeTime
    ? `${BASE_URL}/api/v1/tags/${dataset}?s=e-1h&e=now`
    : `${BASE_URL}/api/v1/tags/${dataset}?s=${startTime}&e=${endTime}`;

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
          dataset,
          filter,
          limit: 1000,
          order: 'DESC',
          returnResults: true,
        }
      : undefined;

  await streamJsonCollect(
    url,
    body,
    {
      'Content-Type': 'application/json',
      'api-key': API_KEY,
    },
    (msg) => {
      if (msg && typeof msg === 'object') {
        Object.keys(msg).forEach((k) => keys.add(k));
      }
    },
    signal
  );

  return Array.from(keys);
}

/**
 * Fetch tag values for logs or metrics
 */
export async function fetchTagValues({
  mode = 'logs',
  metricName,
  metricType,
  labelName,
  filters = [],
  useRelativeTime = false,
  signal,
}: {
  mode?: 'logs' | 'metrics';
  metricName?: string;
  metricType?: string;
  labelName: string;
  filters?: Filter[];
  useRelativeTime?: boolean;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (!labelName) {
    throw new Error('labelName is required');
  }

  const dataset = mode;
  const vals = new Set<string>();

  const url = `${BASE_URL}/api/v1/tags/${dataset}?s=e-1h&e=now&tagName=${encodeURIComponent(
    labelName
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
    if (metricNameFilter && nestedFilter) {
      filter = {
        op: 'and',
        children: [metricNameFilter, nestedFilter],
      };
    } else {
      filter = metricNameFilter ?? nestedFilter;
    }
  } else {
    filter =
      nestedFilter ??
      {
        k: labelName,
        v: [''],
        op: 'has',
        dataType: 'string',
        extracted: false,
        computed: false,
      };
  }

  const body: Record<string, any> = {
    dataset,
    filter,
    limit: 1000,
    order: 'DESC',
    returnResults: true,
  };

  if (mode === 'metrics' && metricType) {
    body.metricType = metricType;
  }

  await streamJsonCollect(
    url,
    body,
    {
      'Content-Type': 'application/json',
      'api-key': API_KEY,
    },
    (msg) => {
      const value = msg?.[labelName];
      if (value !== undefined && value !== null) {
        vals.add(String(value));
      }
    },
    signal
  );

  return Array.from(vals);
}
