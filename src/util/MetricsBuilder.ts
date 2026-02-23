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

import { Aggregation, MyQuery, ValueAs } from '../types';

type NormalizedOp = 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'not_contains' | 'regex' | 'not_regex';

function normalizeOp(op: string | undefined): NormalizedOp {
  const raw = String(op ?? '')
    .trim()
    .toLowerCase();
  const x = raw.replace(/\s+/g, '_').replace(/-+/g, '_');
  switch (x) {
    case '=':
    case '==':
    case 'eq':
      return 'eq';
    case '!=':
    case 'neq':
      return 'neq';
    case 'in':
      return 'in';
    case 'not_in':
    case 'notin':
      return 'not_in';
    case 'contains':
      return 'contains';
    case 'not_contains':
    case 'notcontains':
      return 'not_contains';
    case 'regex':
    case '=~':
      return 'regex';
    case 'not_regex':
    case 'notregex':
    case '!~':
      return 'not_regex';
    default:
      return 'eq';
  }
}

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function escapeRegexLiteral(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}

function toRegexAlternation(values: string[], wrap: 'exact' | 'contains'): string {
  const parts = values.map(escapeRegexLiteral);
  if (wrap === 'exact') {
    return `${parts.join('|')}`;
  }
  return `${parts.join('|')}`;
}

function normalizedLabel(labelName: string): string {
  const trimmed = (labelName || '').trim();
  return trimmed.includes('.') ? `"${trimmed}"` : trimmed;
}

function quote(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderClause(k: string, op: string, v: string | string[] | undefined): string {
  const key = normalizedLabel(k);
  const toArray = (val: string | string[] | undefined): string[] =>
    Array.isArray(val) ? val.map((x) => String(x ?? '')) : [String(val ?? '')];
  const first = (val: string | string[] | undefined): string => toArray(val)[0] ?? '';
  const normalized = normalizeOp(op);

  switch (normalized) {
    case 'eq':
      return `${key}=${quote(first(v))}`;
    case 'neq':
      return `${key}!=${quote(first(v))}`;
    case 'regex': {
      const rx = first(v);
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}=~${quoted}`;
    }
    case 'not_regex': {
      const rx = first(v);
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}!~${quoted}`;
    }
    case 'in': {
      const vals = toArray(v);
      const rx = toRegexAlternation(vals, 'exact');
      return `${key}=~${quote(rx)}`;
    }
    case 'not_in': {
      const vals = toArray(v);
      const rx = toRegexAlternation(vals, 'exact');
      return `${key}!~${quote(rx)}`;
    }
    case 'contains': {
      const vals = toArray(v);
      const rx = toRegexAlternation(vals, 'contains');
      return `${key}=~${quote(rx)}`;
    }
    case 'not_contains': {
      const vals = toArray(v);
      const rx = toRegexAlternation(vals, 'contains');
      return `${key}!~${quote(rx)}`;
    }
  }
}

function isValidPromMetricName(name: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name);
}

export function promqlFromQueryBuilder(qb: MyQuery, rateWindow = '5m'): string {
  const metricName = qb.metricName?.trim();
  const uiType: MyQuery['metricType'] = qb.metricType;
  const groupBys = (qb.groupBy ?? []).map((k) => normalizedLabel(k));
  const aggregation: Aggregation | undefined = qb.aggregation;
  const valueAs: ValueAs | undefined = qb.valueAs;

  const baseFilters = (qb.filters ?? []).filter((f) => {
    if (!f.tag?.trim()) {
      return false;
    }
    if (!Array.isArray(f.value)) {
      return false;
    }
    const norm = normalizeOp(f.op as string);
    const negativeOps: NormalizedOp[] = ['neq', 'not_in', 'not_contains', 'not_regex'];
    if (negativeOps.includes(norm)) {
      return true;
    }
    return f.value.some((v) => v?.trim?.());
  });

  const filterClauses = baseFilters.map((f) => {
    const cleanValues = f.value.map((v) => String(v ?? '').trim()).filter(Boolean);
    return renderClause(f.tag!, f.op as string, cleanValues);
  });

  if (!metricName && filterClauses.length === 0) {
    return '';
  }

  let selector: string;
  if (metricName) {
    if (isValidPromMetricName(metricName)) {
      selector = metricName;
      if (filterClauses.length > 0) {
        selector += `{${filterClauses.join(', ')}}`;
      }
    } else {
      const allClauses = [`__name__=${q(metricName)}`, ...filterClauses];
      selector = `{${allClauses.join(', ')}}`;
    }
  } else {
    selector = `{${filterClauses.join(', ')}}`;
  }

  const hasAgg = Boolean(aggregation);
  const isCount = uiType === 'count';

  if (isCount) {
    let inner = selector;
    if (valueAs === 'rates_per_second') {
      inner = `rate(${selector}[${rateWindow}])`;
    } else if (valueAs === 'count_over_time') {
      inner = `count_over_time(${selector}[${rateWindow}])`;
    } else if (valueAs === 'counts') {
      inner = selector;
    }
    if (hasAgg) {
      return groupBys.length > 0 ? `${aggregation} by (${groupBys.join(',')})(${inner})` : `${aggregation}(${inner})`;
    }
    return inner;
  }

  let inner = selector;

  if (valueAs === 'rates_per_second') {
    inner = `rate(${selector}[${rateWindow}])`;
  } else if (valueAs === 'count_over_time') {
    inner = `count_over_time(${selector}[${rateWindow}])`;
  }

  if (!hasAgg) {
    return inner;
  }

  return groupBys.length > 0 ? `${aggregation} by (${groupBys.join(',')})(${inner})` : `${aggregation}(${inner})`;
}
