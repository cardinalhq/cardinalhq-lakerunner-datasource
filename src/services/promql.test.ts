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

jest.mock('@grafana/data', () => ({
  FieldType: { time: 'time', number: 'number' },
  toDataFrame: (frame: any) => frame,
}));

import { runPromQLQuery } from './promql';
import type { MyQuery } from '../types';

function mockSSEBody(events: string[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(e));
  let idx = 0;

  return {
    getReader: () => ({
      read: async () => {
        if (idx >= chunks.length) {
          return { done: true as const, value: undefined };
        }
        return { done: false as const, value: chunks[idx++] };
      },
    }),
  };
}

describe('runPromQLQuery threshold behavior', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('falls back to unfiltered results when summary stream has no summary events', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockSSEBody([
          'data: {"type":"result","data":{"timestamp":1,"label":"svc-a","value":10}}\n',
          'data: {"type":"done","data":{"status":"ok"}}\n',
        ]),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: mockSSEBody([
          'data: {"type":"result","data":{"timestamp":1,"label":"svc-a","value":10}}\n',
          'data: {"type":"result","data":{"timestamp":2,"label":"svc-a","value":11}}\n',
          'data: {"type":"done","data":{"status":"ok"}}\n',
        ]),
        text: async () => '',
      } as any);

    const target: MyQuery = {
      refId: 'A',
      mode: 'metrics',
      aggregationManuallyDeleted: null,
      promqlOutput: 'sum(rate(calls[5m]))',
      valueThreshold: { enabled: true, operator: '>', value: 1000 },
    };

    const frames = await runPromQLQuery(
      5,
      target,
      {
        from: { valueOf: () => 1000 } as any,
        to: { valueOf: () => 2000 } as any,
      } as any,
      new AbortController().signal,
      undefined,
      true
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(1);
    expect(frames[0].fields[1].values.length).toBe(2);
  });
});
