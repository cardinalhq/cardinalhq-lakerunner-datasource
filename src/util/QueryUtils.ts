export interface EventSourceOptions extends RequestInit {
  headers?: Record<string, string>;
  apiKey?: string;
  onmessage: (event: MessageEvent<any>) => void;
  onerror?: (err: any) => void;
  openWhenHidden?: boolean;
  signal?: AbortSignal;
}

export function apiFetchEventSourceWrapper(
  url: string,
  {
    headers = {},
    apiKey = '',
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
    ...headers,
    'Content-Type': 'application/json',
    'api-key': apiKey,
  };

  fetch(url, { ...fetchOptions, headers: fullHeaders, signal })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        throw new Error(`SSE request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}
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
