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

import { rateWindowForRange } from './rateWindow';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const base = Date.now();

describe('rateWindowForRange', () => {
  it.each([
    ['≤ 65 min returns 20s', base, base + 65 * MINUTE, '20s'],
    ['exactly 65 min boundary', base, base + 65 * MINUTE, '20s'],
    ['just above 65 min returns 2m', base, base + 65 * MINUTE + 1, '2m'],
    ['≤ 12h returns 2m', base, base + 12 * HOUR, '2m'],
    ['just above 12h returns 10m', base, base + 12 * HOUR + 1, '10m'],
    ['≤ 24h returns 10m', base, base + DAY, '10m'],
    ['just above 24h returns 40m', base, base + DAY + 1, '40m'],
    ['≤ 3 days returns 40m', base, base + 3 * DAY, '40m'],
    ['just above 3 days returns 2h', base, base + 3 * DAY + 1, '2h'],
    ['7 days returns 2h', base, base + 7 * DAY, '2h'],
    ['30 min returns 20s', base, base + 30 * MINUTE, '20s'],
    ['6 hours returns 2m', base, base + 6 * HOUR, '2m'],
  ])('%s', (_label, start, end, expected) => {
    expect(rateWindowForRange(start, end)).toBe(expected);
  });

  describe('invalid / missing inputs return 5m', () => {
    it('undefined start', () => {
      expect(rateWindowForRange(undefined, base + HOUR)).toBe('5m');
    });
    it('undefined end', () => {
      expect(rateWindowForRange(base, undefined)).toBe('5m');
    });
    it('both undefined', () => {
      expect(rateWindowForRange(undefined, undefined)).toBe('5m');
    });
    it('no arguments', () => {
      expect(rateWindowForRange()).toBe('5m');
    });
    it('end < start', () => {
      expect(rateWindowForRange(base + HOUR, base)).toBe('5m');
    });
    it('NaN start', () => {
      expect(rateWindowForRange(NaN, base + HOUR)).toBe('5m');
    });
    it('Infinity end', () => {
      expect(rateWindowForRange(base, Infinity)).toBe('5m');
    });
  });
});
