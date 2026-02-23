import { promqlFromQueryBuilder } from './MetricsBuilder';
import { MyQuery } from '../types';

function makeQuery(overrides: Partial<MyQuery> = {}): MyQuery {
  return {
    refId: 'A',
    datasource: null as any,
    aggregationManuallyDeleted: false,
    metricName: 'http_requests_total',
    metricType: 'count',
    filters: [],
    groupBy: [],
    aggregation: 'sum',
    valueAs: 'rates_per_second',
    ...overrides,
  };
}

describe('promqlFromQueryBuilder rate window', () => {
  it('defaults to [5m] when rateWindow is omitted', () => {
    const expr = promqlFromQueryBuilder(makeQuery());
    expect(expr).toContain('[5m]');
  });

  it('uses explicit rateWindow in rate()', () => {
    const expr = promqlFromQueryBuilder(makeQuery(), '20s');
    expect(expr).toContain('rate(http_requests_total[20s])');
    expect(expr).not.toContain('[5m]');
  });

  it('uses explicit rateWindow in count_over_time()', () => {
    const expr = promqlFromQueryBuilder(makeQuery({ valueAs: 'count_over_time' }), '2h');
    expect(expr).toContain('count_over_time(http_requests_total[2h])');
  });

  it('does not inject a window when valueAs is counts', () => {
    const expr = promqlFromQueryBuilder(makeQuery({ valueAs: 'counts' }), '10m');
    expect(expr).not.toContain('[');
  });

  it('does not inject a window when valueAs is values (gauge)', () => {
    const expr = promqlFromQueryBuilder(
      makeQuery({ metricType: 'gauge', valueAs: 'values', aggregation: 'max' }),
      '40m'
    );
    expect(expr).not.toContain('[');
  });

  it('works for non-count metric type with rate', () => {
    const expr = promqlFromQueryBuilder(
      makeQuery({ metricType: 'gauge', valueAs: 'rates_per_second', aggregation: 'avg' }),
      '2m'
    );
    expect(expr).toContain('rate(http_requests_total[2m])');
  });
});
