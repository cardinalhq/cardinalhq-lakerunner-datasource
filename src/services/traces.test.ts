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

import {
  getTraceId,
  getSpanId,
  getParentSpanId,
  getStartTs,
  getDurationMs,
  getServiceName,
  getOperationName,
  getSelectedTraceId,
} from './traces';

describe('trace extraction functions', () => {
  describe('getTraceId', () => {
    it('extracts trace_id from tags', () => {
      expect(getTraceId({ trace_id: 'abc123' })).toBe('abc123');
    });

    it('returns empty string when missing', () => {
      expect(getTraceId({})).toBe('');
    });
  });

  describe('getSpanId', () => {
    it('extracts id from tags', () => {
      expect(getSpanId({ id: 'span-1' })).toBe('span-1');
    });

    it('returns empty string when missing', () => {
      expect(getSpanId({})).toBe('');
    });
  });

  describe('getParentSpanId', () => {
    it('extracts parent_span_id from tags', () => {
      expect(getParentSpanId({ parent_span_id: 'parent-1' })).toBe('parent-1');
    });

    it('returns empty string when missing', () => {
      expect(getParentSpanId({})).toBe('');
    });
  });

  describe('getStartTs', () => {
    it('extracts start_timestamp from tags', () => {
      expect(getStartTs({ start_timestamp: 1700000000000 }, 0)).toBe(1700000000000);
    });

    it('uses fallback when missing', () => {
      expect(getStartTs({}, 1700000000000)).toBe(1700000000000);
    });
  });

  describe('getDurationMs', () => {
    it('extracts duration from tags', () => {
      expect(getDurationMs({ duration: 150 })).toBe(150);
    });

    it('rounds fractional durations', () => {
      expect(getDurationMs({ duration: 1.7 })).toBe(2);
    });

    it('clamps to minimum 1ms', () => {
      expect(getDurationMs({ duration: 0 })).toBe(1);
      expect(getDurationMs({ duration: -5 })).toBe(1);
    });

    it('returns 1 for missing or non-numeric values', () => {
      expect(getDurationMs({})).toBe(1);
      expect(getDurationMs({ duration: 'fast' })).toBe(1);
    });
  });

  describe('getServiceName', () => {
    it('extracts service_name from tags', () => {
      expect(getServiceName({ service_name: 'api-gateway' })).toBe('api-gateway');
    });

    it('returns empty string when missing', () => {
      expect(getServiceName({})).toBe('');
    });
  });

  describe('getOperationName', () => {
    it('extracts name from tags', () => {
      expect(getOperationName({ name: 'GET /users' })).toBe('GET /users');
    });

    it('falls back to _cardinalhq_name', () => {
      expect(getOperationName({ _cardinalhq_name: 'internal-op' })).toBe('internal-op');
    });

    it('returns empty string when missing', () => {
      expect(getOperationName({})).toBe('');
    });
  });

  describe('getSelectedTraceId', () => {
    it('finds trace_id filter with single value', () => {
      const filters = [
        { tag: 'service_name', op: '=' as const, value: ['api'] },
        { tag: 'trace_id', op: '=' as const, value: ['abc123'] },
      ];
      expect(getSelectedTraceId(filters)).toBe('abc123');
    });

    it('returns undefined when no trace_id filter', () => {
      const filters = [{ tag: 'service_name', op: '=' as const, value: ['api'] }];
      expect(getSelectedTraceId(filters)).toBeUndefined();
    });

    it('returns undefined for empty trace_id value', () => {
      const filters = [{ tag: 'trace_id', op: '=' as const, value: ['  '] }];
      expect(getSelectedTraceId(filters)).toBeUndefined();
    });

    it('returns undefined for multi-value trace_id filter', () => {
      const filters = [{ tag: 'trace_id', op: '=' as const, value: ['abc', 'def'] }];
      expect(getSelectedTraceId(filters)).toBeUndefined();
    });

    it('returns undefined for non-equals operator', () => {
      const filters = [{ tag: 'trace_id', op: '!=' as const, value: ['abc123'] }];
      expect(getSelectedTraceId(filters)).toBeUndefined();
    });
  });
});
