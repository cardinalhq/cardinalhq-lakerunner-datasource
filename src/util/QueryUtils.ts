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

export interface EventSourceOptions extends RequestInit {
  headers?: Record<string, string>;
  onmessage: (event: MessageEvent<any>) => void;
  onerror?: (err: any) => void;
  openWhenHidden?: boolean;
  signal?: AbortSignal;
}

export function apiFetchEventSourceWrapper(
  url: string,
  {
    headers = {},
    onmessage,
    onerror,
    openWhenHidden = false,
    signal: externalSignal,
    ...fetchOptions
  }: EventSourceOptions
): AbortController {
  const controller = externalSignal ? null : new AbortController();
  const signal = externalSignal ?? controller!.signal;

  const fullHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  fetch(url, {
    ...fetchOptions,
    headers: fullHeaders,
    signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`SSE request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          if (line.startsWith('data:')) {
            onmessage({ data: line.slice(5).trim() } as MessageEvent<any>);
          }
          buffer = buffer.slice(idx + 1);
        }
      }
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        return;
      }
      if (onerror) {
        onerror(err);
      }
    });

  if (!openWhenHidden && controller) {
    const onVis = () => controller.abort();
    document.addEventListener('visibilitychange', onVis);
  }

  return controller ?? new AbortController();
}

export function truncateTo1Min(epochMillis: number) {
  const ONE_MINUTE_MS = 1 * 60 * 1000;
  return Math.floor(epochMillis / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}
