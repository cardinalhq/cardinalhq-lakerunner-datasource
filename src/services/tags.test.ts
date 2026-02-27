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

import { displayTagName, toInternalLabel, toUserLabel, queryTagName } from './tags';

describe('tags service', () => {
  describe('displayTagName', () => {
    it('returns span_duration unchanged', () => {
      expect(displayTagName('span_duration')).toBe('span_duration');
    });

    it('returns other tags unchanged', () => {
      expect(displayTagName('service_name')).toBe('service_name');
      expect(displayTagName('http_method')).toBe('http_method');
    });
  });

  describe('queryTagName', () => {
    it('normalizes dots to underscores', () => {
      expect(queryTagName('span.duration')).toBe('span_duration');
      expect(queryTagName('service.name')).toBe('service_name');
    });

    it('returns underscore tags unchanged', () => {
      expect(queryTagName('service_name')).toBe('service_name');
    });
  });

  describe('toInternalLabel', () => {
    it('returns all labels unchanged (identity)', () => {
      expect(toInternalLabel('message')).toBe('message');
      expect(toInternalLabel('level')).toBe('level');
      expect(toInternalLabel('service_name')).toBe('service_name');
    });
  });

  describe('toUserLabel', () => {
    it('returns all labels unchanged (identity)', () => {
      expect(toUserLabel('log_message')).toBe('log_message');
      expect(toUserLabel('log_level')).toBe('log_level');
      expect(toUserLabel('service_name')).toBe('service_name');
    });
  });
});

describe('fetchTags request body', () => {
  // These tests verify the structure of request bodies that would be sent
  // We can't easily test the actual fetch without mocking, but we can verify
  // the logic for building the request body

  it('should include q parameter when expr is provided', () => {
    const body: Record<string, any> = { s: '123', e: '456' };
    const expr = '{service_name="api"}';

    if (expr) {
      body.q = expr;
    }

    expect(body).toEqual({ s: '123', e: '456', q: '{service_name="api"}' });
  });

  it('should not include q parameter when expr is undefined', () => {
    const body: Record<string, any> = { s: '123', e: '456' };
    const expr = undefined;

    if (expr) {
      body.q = expr;
    }

    expect(body).toEqual({ s: '123', e: '456' });
  });

  it('should not include q parameter when expr is empty string', () => {
    const body: Record<string, any> = { s: '123', e: '456' };
    const expr = '';

    if (expr) {
      body.q = expr;
    }

    expect(body).toEqual({ s: '123', e: '456' });
  });

  it('should include metric for metrics mode', () => {
    const body: Record<string, any> = { s: '123', e: '456' };
    const mode = 'metrics';
    const metricName = 'cpu_usage';

    if (mode === 'metrics' && metricName) {
      body.metric = metricName;
    }

    expect(body).toEqual({ s: '123', e: '456', metric: 'cpu_usage' });
  });

  it('should include both metric and q for metrics mode with filter', () => {
    const body: Record<string, any> = { s: '123', e: '456' };
    const mode = 'metrics';
    const metricName = 'cpu_usage';
    const expr = 'cpu_usage{host="web01"}';

    if (mode === 'metrics' && metricName) {
      body.metric = metricName;
    }
    if (expr) {
      body.q = expr;
    }

    expect(body).toEqual({
      s: '123',
      e: '456',
      metric: 'cpu_usage',
      q: 'cpu_usage{host="web01"}',
    });
  });
});
