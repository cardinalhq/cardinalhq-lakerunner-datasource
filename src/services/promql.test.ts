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

import { runPromQLQuery, applyLegendFormat, applyRateWindow } from './promql';
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
      'uid-5',
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

describe('applyLegendFormat', () => {
  it('substitutes matching tag keys', () => {
    expect(applyLegendFormat('{{svc}} - {{env}}', { svc: 'frontend', env: 'prod' })).toBe('frontend - prod');
  });

  it('leaves unresolved placeholders as-is', () => {
    expect(applyLegendFormat('{{svc}} - {{missing}}', { svc: 'frontend' })).toBe('frontend - {{missing}}');
  });

  it('returns null for empty format', () => {
    expect(applyLegendFormat('', { svc: 'frontend' })).toBeNull();
  });

  it('returns null when tags are undefined', () => {
    expect(applyLegendFormat('{{svc}}', undefined)).toBeNull();
  });

  it('substitutes keys with dots, dashes, and colons', () => {
    expect(
      applyLegendFormat('{{resource.service.name}} / {{k8s-pod:name}}', {
        'resource.service.name': 'frontend',
        'k8s-pod:name': 'web-0',
      })
    ).toBe('frontend / web-0');
  });
});

describe('runPromQLQuery legendFormat', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('applies legendFormat template to display name', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockSSEBody([
        'data: {"type":"result","data":{"timestamp":1000,"label":"raw-label","value":42,"tags":{"service_name":"frontend","__name__":"http_duration"}}}\n',
      ]),
      text: async () => '',
    } as any);

    const target: MyQuery = {
      refId: 'A',
      mode: 'metrics',
      aggregationManuallyDeleted: null,
      promqlOutput: 'some_metric',
      legendFormat: '{{service_name}}',
    };

    const frames = await runPromQLQuery(
      'uid-1',
      target,
      { from: { valueOf: () => 0 } as any, to: { valueOf: () => 2000 } as any } as any,
      new AbortController().signal
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields[1].config.displayNameFromDS).toBe('frontend');
    expect(frames[0].fields[1].labels).toEqual({
      service_name: 'frontend',
      __name__: 'http_duration',
    });
  });

  it('falls back to raw label when legendFormat is empty', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockSSEBody([
        'data: {"type":"result","data":{"timestamp":1000,"label":"my-raw-label","value":42,"tags":{"svc":"frontend"}}}\n',
      ]),
      text: async () => '',
    } as any);

    const target: MyQuery = {
      refId: 'A',
      mode: 'metrics',
      aggregationManuallyDeleted: null,
      promqlOutput: 'some_metric',
    };

    const frames = await runPromQLQuery(
      'uid-1',
      target,
      { from: { valueOf: () => 0 } as any, to: { valueOf: () => 2000 } as any } as any,
      new AbortController().signal
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields[1].config.displayNameFromDS).toBe('my-raw-label');
    expect(frames[0].fields[1].labels).toEqual({ svc: 'frontend' });
  });

  it('sets tags as field labels even without legendFormat', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockSSEBody([
        'data: {"type":"result","data":{"timestamp":1000,"label":"lbl","value":1}}\n',
      ]),
      text: async () => '',
    } as any);

    const target: MyQuery = {
      refId: 'A',
      mode: 'metrics',
      aggregationManuallyDeleted: null,
      promqlOutput: 'metric',
    };

    const frames = await runPromQLQuery(
      'uid-1',
      target,
      { from: { valueOf: () => 0 } as any, to: { valueOf: () => 2000 } as any } as any,
      new AbortController().signal
    );

    expect(frames).toHaveLength(1);
    // No tags in SSE data → labels should be undefined
    expect(frames[0].fields[1].labels).toBeUndefined();
  });

  it('falls back to raw label when legendFormat is set but tags are missing', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: mockSSEBody([
        'data: {"type":"result","data":{"timestamp":1000,"label":"raw-label","value":5}}\n',
      ]),
      text: async () => '',
    } as any);

    const target: MyQuery = {
      refId: 'A',
      mode: 'metrics',
      aggregationManuallyDeleted: null,
      promqlOutput: 'metric',
      legendFormat: '{{service_name}}',
    };

    const frames = await runPromQLQuery(
      'uid-1',
      target,
      { from: { valueOf: () => 0 } as any, to: { valueOf: () => 2000 } as any } as any,
      new AbortController().signal
    );

    expect(frames).toHaveLength(1);
    expect(frames[0].fields[1].config.displayNameFromDS).toBe('raw-label');
  });
});

describe('applyRateWindow', () => {
  const base = Date.now();
  const HOUR = 60 * 60_000;

  it('rewrites rate window for a 7-day range', () => {
    const sevenDays = 7 * 24 * HOUR;
    expect(applyRateWindow('sum(rate(http_total[5m]))', base, base + sevenDays)).toBe(
      'sum(rate(http_total[2h]))'
    );
  });

  it('rewrites multiple windows in one expression', () => {
    const sevenDays = 7 * 24 * HOUR;
    expect(
      applyRateWindow('rate(a[5m]) / rate(b[1m])', base, base + sevenDays)
    ).toBe('rate(a[2h]) / rate(b[2h])');
  });

  it('uses 20s for short ranges', () => {
    expect(applyRateWindow('rate(x[5m])', base, base + 30 * 60_000)).toBe('rate(x[20s])');
  });

  it('leaves expressions without range vectors unchanged', () => {
    expect(applyRateWindow('http_requests_total', base, base + HOUR)).toBe('http_requests_total');
  });
});
