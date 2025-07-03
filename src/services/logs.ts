import { ExploreQuery } from '../types';
import {
  apiFetchEventSourceWrapper,
  EventSourceOptions,
} from '../util/QueryUtils';

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
export async function fetchTagKeys({
  useRelativeTime = false,
  startTime,
  endTime,
  query,
  signal,
}: {
  useRelativeTime?: boolean;
  startTime?: number;
  endTime?: number;
  query?: ExploreQuery;
  signal?: AbortSignal;
}): Promise<string[]> {
  const keys = new Set<string>();
  const url = useRelativeTime
    ? `${BASE_URL}/api/v1/tags/logs?s=e-1h&e=now`
    : `${BASE_URL}/api/v1/tags/logs?s=${startTime}&e=${endTime}`;

  const body = useRelativeTime ? undefined : (query?.params?.filters?.length ? query : undefined);

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
export async function fetchTagValues({
  labelName,
  useRelativeTime = false,
  signal,
}: {
  labelName: string;
  useRelativeTime?: boolean;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (!labelName) {
    throw new Error('labelName is required');
  }

  const vals = new Set<string>();
  const url = `${BASE_URL}/api/v1/tags/logs?s=e-1h&e=now&tagName=${encodeURIComponent(
    labelName,
  )}&dataType=string`;

  const body = {
    dataset: 'logs',
    filter: {
      k: labelName,
      v: [''],
      op: 'has',
      dataType: 'string',
      extracted: false,
      computed: false,
    },
    limit: 1000,
    order: 'DESC',
    returnResults: true,
  };

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
    signal,
  );

  return Array.from(vals);
}