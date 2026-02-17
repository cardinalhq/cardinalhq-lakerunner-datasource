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

export type ValueThresholdOperator = '>' | '<' | '>=' | '<=';

export interface ValueThreshold {
  enabled: boolean;
  operator: ValueThresholdOperator;
  value: number;
}

export interface SeriesSummary {
  label: string;
  tags: Record<string, string | number>;
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Checks if a series summary matches the given threshold condition.
 */
export function matchesThreshold(summary: SeriesSummary, threshold: ValueThreshold): boolean {
  const value = summary.max; // We use max value for threshold comparison
  switch (threshold.operator) {
    case '>':
      return value > threshold.value;
    case '<':
      return value < threshold.value;
    case '>=':
      return value >= threshold.value;
    case '<=':
      return value <= threshold.value;
    default:
      return true;
  }
}
