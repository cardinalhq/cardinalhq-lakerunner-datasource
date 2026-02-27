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

import { matchesThreshold, SeriesSummary, ValueThreshold } from './threshold';

// Real summary data from sum by (service_name)(rate(calls[5m])) query
const SAMPLE_SUMMARIES: SeriesSummary[] = [
  {
    label: 'sum by (service_name)(rate(calls{service_name=currencyservice}[5m]))',
    tags: { name: 'calls', service_name: 'currencyservice' },
    min: 4.1811079292533595,
    max: 6.394710921526685,
    avg: 5.382724722723641,
    sum: 177.62991584988018,
    count: 33,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
  },
  {
    label: 'sum by (service_name)(rate(calls{service_name=flagd}[5m]))',
    tags: { name: 'calls', service_name: 'flagd' },
    min: 0.2630220481287287,
    max: 18.645886260691476,
    avg: 12.79573528655097,
    sum: 422.259264456182,
    count: 33,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
  },
  {
    label: 'sum by (service_name)(rate(calls{service_name=frontend}[5m]))',
    tags: { name: 'calls', service_name: 'frontend' },
    min: 72.5337204683227,
    max: 112.29705322273604,
    avg: 94.98994087507637,
    sum: 3134.66804887752,
    count: 33,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
  },
  {
    label: 'sum by (service_name)(rate(calls{service_name=frontendproxy}[5m]))',
    tags: { name: 'calls', service_name: 'frontendproxy' },
    min: 92.67599745004614,
    max: 147.26259511239653,
    avg: 122.54247722049513,
    sum: 4043.9017482763393,
    count: 33,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
  },
  {
    label: 'sum by (service_name)(rate(calls{service_name=quoteservice}[5m]))',
    tags: { name: 'calls', service_name: 'quoteservice' },
    min: 0.10174199760102882,
    max: 0.24415176204290162,
    avg: 0.15983098409341534,
    sum: 5.274422475082706,
    count: 33,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
  },
];

describe('matchesThreshold', () => {
  describe('greater than operator', () => {
    const threshold: ValueThreshold = { enabled: true, operator: '>', value: 100 };

    it('returns true when max > threshold', () => {
      // frontendproxy max: 147.26
      expect(matchesThreshold(SAMPLE_SUMMARIES[3], threshold)).toBe(true);
      // frontend max: 112.29
      expect(matchesThreshold(SAMPLE_SUMMARIES[2], threshold)).toBe(true);
    });

    it('returns false when max <= threshold', () => {
      // currencyservice max: 6.39
      expect(matchesThreshold(SAMPLE_SUMMARIES[0], threshold)).toBe(false);
      // flagd max: 18.64
      expect(matchesThreshold(SAMPLE_SUMMARIES[1], threshold)).toBe(false);
    });

    it('returns false when max equals threshold', () => {
      const exactThreshold: ValueThreshold = { enabled: true, operator: '>', value: 112.29705322273604 };
      expect(matchesThreshold(SAMPLE_SUMMARIES[2], exactThreshold)).toBe(false);
    });
  });

  describe('less than operator', () => {
    const threshold: ValueThreshold = { enabled: true, operator: '<', value: 10 };

    it('returns true when max < threshold', () => {
      // currencyservice max: 6.39
      expect(matchesThreshold(SAMPLE_SUMMARIES[0], threshold)).toBe(true);
      // quoteservice max: 0.24
      expect(matchesThreshold(SAMPLE_SUMMARIES[4], threshold)).toBe(true);
    });

    it('returns false when max >= threshold', () => {
      // flagd max: 18.64
      expect(matchesThreshold(SAMPLE_SUMMARIES[1], threshold)).toBe(false);
      // frontend max: 112.29
      expect(matchesThreshold(SAMPLE_SUMMARIES[2], threshold)).toBe(false);
    });
  });

  describe('greater than or equal operator', () => {
    const threshold: ValueThreshold = { enabled: true, operator: '>=', value: 112.29705322273604 };

    it('returns true when max >= threshold', () => {
      // frontend max: exactly 112.29705322273604
      expect(matchesThreshold(SAMPLE_SUMMARIES[2], threshold)).toBe(true);
      // frontendproxy max: 147.26
      expect(matchesThreshold(SAMPLE_SUMMARIES[3], threshold)).toBe(true);
    });

    it('returns false when max < threshold', () => {
      // flagd max: 18.64
      expect(matchesThreshold(SAMPLE_SUMMARIES[1], threshold)).toBe(false);
    });
  });

  describe('less than or equal operator', () => {
    const threshold: ValueThreshold = { enabled: true, operator: '<=', value: 6.394710921526685 };

    it('returns true when max <= threshold', () => {
      // currencyservice max: exactly 6.394710921526685
      expect(matchesThreshold(SAMPLE_SUMMARIES[0], threshold)).toBe(true);
      // quoteservice max: 0.24
      expect(matchesThreshold(SAMPLE_SUMMARIES[4], threshold)).toBe(true);
    });

    it('returns false when max > threshold', () => {
      // flagd max: 18.64
      expect(matchesThreshold(SAMPLE_SUMMARIES[1], threshold)).toBe(false);
    });
  });

  describe('filtering real data', () => {
    it('filters to only high-traffic services (max > 50)', () => {
      const threshold: ValueThreshold = { enabled: true, operator: '>', value: 50 };
      const filtered = SAMPLE_SUMMARIES.filter((s) => matchesThreshold(s, threshold));

      expect(filtered).toHaveLength(2);
      expect(filtered.map((s) => s.tags.service_name)).toEqual(['frontend', 'frontendproxy']);
    });

    it('filters to only low-traffic services (max < 1)', () => {
      const threshold: ValueThreshold = { enabled: true, operator: '<', value: 1 };
      const filtered = SAMPLE_SUMMARIES.filter((s) => matchesThreshold(s, threshold));

      expect(filtered).toHaveLength(1);
      expect(filtered[0].tags.service_name).toBe('quoteservice');
    });

    it('returns all services when threshold is very low', () => {
      const threshold: ValueThreshold = { enabled: true, operator: '>', value: 0 };
      const filtered = SAMPLE_SUMMARIES.filter((s) => matchesThreshold(s, threshold));

      expect(filtered).toHaveLength(5);
    });

    it('returns no services when threshold is very high', () => {
      const threshold: ValueThreshold = { enabled: true, operator: '>', value: 1000 };
      const filtered = SAMPLE_SUMMARIES.filter((s) => matchesThreshold(s, threshold));

      expect(filtered).toHaveLength(0);
    });
  });
});
