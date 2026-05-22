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
  FieldType: { time: 'time', number: 'number', string: 'string', other: 'other' },
  DataFrameType: { LogLines: 'LogLines' },
  toDataFrame: (frame: any) => frame,
}));

import { runLogQLQuery } from './logql';

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

const range = { from: { valueOf: () => 1000 }, to: { valueOf: () => 2000 } } as any;

const target = {
  refId: 'A',
  mode: 'logs',
  logqlSubTab: 'code',
  logqlOutput: '{job="x"}',
  logqlEdited: true,
};

describe('runLogQLQuery log row id', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('derives a unique id from chq_tsns and keeps the non-unique chq_fingerprint separate', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: mockSSEBody([
        // two rows that share one fingerprint (a similarity key) but have distinct chq_tsns
        'data: {"type":"result","data":{"timestamp":1500,"tags":{"chq_tsns":"1700000000000000000","chq_fingerprint":12345,"message":"hello a","level":"info"}}}\n',
        'data: {"type":"result","data":{"timestamp":1600,"tags":{"chq_tsns":"1700000000000000001","chq_fingerprint":12345,"message":"hello b","level":"info"}}}\n',
        'data: {"type":"done","data":{"status":"ok"}}\n',
      ]),
      text: async () => '',
    } as any);

    const frames = await runLogQLQuery('uid-1', target, range, new AbortController().signal);

    const logs = frames.find((f: any) => f.name === 'logs') as any;
    expect(logs).toBeDefined();

    const fieldValues = (name: string) => logs.fields.find((x: any) => x.name === name).values as string[];
    const ids = fieldValues('id');
    const fingerprints = fieldValues('fingerprint');

    // ids are unique per row and derived from chq_tsns
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(expect.arrayContaining([expect.stringMatching(/^1700000000000000000_/), expect.stringMatching(/^1700000000000000001_/)]));

    // fingerprint is the (shared, non-unique) similarity key, not the row id
    expect(fingerprints).toEqual(['12345', '12345']);
  });
});
