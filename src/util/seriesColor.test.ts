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

import { buildSeriesColorKey, colorForSeries } from './seriesColor';

describe('seriesColor', () => {
  it('builds the same key regardless of label object insertion order', () => {
    const a = buildSeriesColorKey('svc', { env: 'prod', region: 'us-east-1' });
    const b = buildSeriesColorKey('svc', { region: 'us-east-1', env: 'prod' });
    expect(a).toBe(b);
  });

  it('returns deterministic hex color for same series', () => {
    const c1 = colorForSeries('svc', { env: 'prod', region: 'us-east-1' });
    const c2 = colorForSeries('svc', { region: 'us-east-1', env: 'prod' });
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns different colors for different series keys', () => {
    const c1 = colorForSeries('svc-a', { env: 'prod' });
    const c2 = colorForSeries('svc-b', { env: 'prod' });
    expect(c1).not.toBe(c2);
  });

  it('builds expected key format', () => {
    expect(buildSeriesColorKey('svc', { env: 'prod' })).toBe('svc|env=prod');
    expect(buildSeriesColorKey('svc', { env: 'prod', region: 'us-east-1' })).toBe('svc|env=prod,region=us-east-1');
    expect(buildSeriesColorKey('my-series')).toBe('my-series|');
  });

  it('works when labels are undefined', () => {
    const c = colorForSeries('my-series');
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
