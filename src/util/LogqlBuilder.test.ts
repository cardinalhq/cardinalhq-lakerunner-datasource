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

import { buildLogQLExpressions } from './LogqlBuilder';

describe('buildLogQLExpressions', () => {
  describe('filtersExpr for tag scoping', () => {
    it('returns empty selector for no filters', () => {
      const result = buildLogQLExpressions({ filters: [] });
      expect(result.filtersExpr).toBe('{}');
    });

    it('returns empty selector for filters with no values', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'service_name', op: '=', value: [] }],
      });
      expect(result.filtersExpr).toBe('{}');
    });

    it('builds selector for single eq filter', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'service_name', op: '=', value: ['api-gateway'] }],
      });
      expect(result.filtersExpr).toBe('{service_name="api-gateway"}');
    });

    it('builds selector for multiple filters', () => {
      const result = buildLogQLExpressions({
        filters: [
          { tag: 'service_name', op: '=', value: ['api-gateway'] },
          { tag: 'env', op: '=', value: ['prod'] },
        ],
      });
      expect(result.filtersExpr).toBe('{service_name="api-gateway", env="prod"}');
    });

    it('builds selector for not equals filter', () => {
      const result = buildLogQLExpressions({
        filters: [
          { tag: 'service_name', op: '=', value: ['api'] },
          { tag: 'env', op: '!=', value: ['dev'] },
        ],
      });
      expect(result.filtersExpr).toBe('{service_name="api", env!="dev"}');
    });

    it('builds selector for in filter using regex alternation', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'env', op: 'in', value: ['prod', 'staging'] }],
      });
      expect(result.filtersExpr).toContain('env=~');
      expect(result.filtersExpr).toContain('prod');
      expect(result.filtersExpr).toContain('staging');
    });

    it('builds selector for contains filter', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'service_name', op: 'contains', value: ['api'] }],
      });
      expect(result.filtersExpr).toContain('service_name=~');
      expect(result.filtersExpr).toContain('api');
    });

    it('builds selector for regex filter', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'service_name', op: 'regex', value: ['api-.*'] }],
      });
      expect(result.filtersExpr).toBe('{service_name=~"api-.*"}');
    });

    it('builds selector for has filter', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'trace_id', op: 'has', value: [] }],
      });
      // has operator produces != "" which is negative, so a positive matcher is also added
      expect(result.filtersExpr).toContain('trace_id!=""');
    });

    it('normalizes dotted tag names to underscores', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'resource.service.name', op: '=', value: ['api'] }],
      });
      expect(result.filtersExpr).toBe('{resource_service_name="api"}');
    });

    it('escapes special characters in values', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'path', op: '=', value: ['path/with"quotes'] }],
      });
      expect(result.filtersExpr).toContain('\\"');
    });

    it('adds positive matcher when only negative filters present', () => {
      const result = buildLogQLExpressions({
        filters: [{ tag: 'env', op: '!=', value: ['dev'] }],
      });
      // Should add a positive matcher to avoid empty selector
      expect(result.filtersExpr).toContain('env=~".+"');
      expect(result.filtersExpr).toContain('env!="dev"');
    });
  });
});
