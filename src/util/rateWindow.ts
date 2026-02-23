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

const ONE_HOUR_ISH = 65 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

/**
 * Derive a PromQL range-vector window from the active time range.
 * Uses 2× the backend step that LakeRunner applies for each tier.
 */
export function rateWindowForRange(startMs?: number, endMs?: number): string {
  if (startMs == null || endMs == null || !isFinite(startMs) || !isFinite(endMs) || endMs < startMs) {
    return '5m';
  }

  const diff = endMs - startMs;
  if (diff <= ONE_HOUR_ISH) {
    return '20s';
  }
  if (diff <= TWELVE_HOURS) {
    return '2m';
  }
  if (diff <= ONE_DAY) {
    return '10m';
  }
  if (diff <= THREE_DAYS) {
    return '40m';
  }
  return '2h';
}
