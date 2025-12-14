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

import { toInternalLabel } from 'services/tags';
import { Filter, MyQuery, Operator } from '../types';

const isNonEmpty = (s?: string) => !!s && s.trim().length > 0;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const escRegexAlt = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
const normalizeTag = (tag: string) => tag.replace(/\./g, '_');
const normalizeWindow = (w: string) => (w === '__interval' ? '$__interval' : w);

const HIDDEN_TAGS = new Set(['fingerprint', 'chq_fingerprint', '_cardinalhq_fingerprint']);
const isHiddenTag = (tag: string) => HIDDEN_TAGS.has(tag);
const MESSAGE_TAGS = new Set(['log_message']);

const NUMERIC_AFTER_SELECTOR = new Set(['span_duration', 'span_duration']);
const isComparisonOp = (op?: Operator) => op === '<' || op === '<=' || op === '>' || op === '>=';

function parseDurationToMs(v?: string): number | null {
  if (!isNonEmpty(v)) {
    return null;
  }
  const raw = String(v).trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!m) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const num = Number(m[1]);
  if (!Number.isFinite(num) || num < 0) {
    return null;
  }
  const unit = (m[2] ?? 'ms').toLowerCase();
  switch (unit) {
    case 'ms':
      return num;
    case 's':
      return num * 1000;
    case 'm':
      return num * 60000;
    default:
      return num;
  }
}

function labelMatcher(f: Filter, hideHidden = false): string | null {
  const { tag: rawTag, op, value } = f;
  if (!isNonEmpty(rawTag)) {
    return null;
  }

  const tag = toInternalLabel(rawTag);

  if (hideHidden && isHiddenTag(tag)) {
    return null;
  }
  if (MESSAGE_TAGS.has(tag)) {
    return null;
  }

  if (NUMERIC_AFTER_SELECTOR.has(tag) && isComparisonOp(op as Operator)) {
    return null;
  }

  const safeTag = normalizeTag(tag);
  const vals = (value ?? []).filter(isNonEmpty);
  const first = vals[0];

  switch (op as Operator) {
    case '=':
      return first ? `${safeTag}="${esc(first)}"` : null;
    case '!=':
      return first ? `${safeTag}!="${esc(first)}"` : null;
    case 'in':
      return vals.length ? `${safeTag}=~"^(?:${vals.map(escRegexAlt).join('|')})$"` : null;
    case 'not_in':
      return vals.length ? `${safeTag}!~"^(?:${vals.map(escRegexAlt).join('|')})$"` : null;
    case 'contains':
      return first ? `${safeTag}=~"${esc(first)}"` : null;
    case 'not contains':
      return first ? `${safeTag}!~"${esc(first)}"` : null;
    case 'regex':
      return first ? `${safeTag}=~"${first}"` : null;
    case 'not regex':
      return first ? `${safeTag}!~"${first}"` : null;
    case 'has':
      return `${safeTag}!=""`;
    default:
      return null;
  }
}

function selector(filters: Filter[], hideHidden = false): string {
  const parts = filters.map((f) => labelMatcher(f, hideHidden)).filter(Boolean) as string[];

  const hasPositive = parts.some((p) => p.includes('=') && !p.includes('!=') && !p.includes('!~'));
  const hasNegative = parts.some((p) => p.includes('!=') || p.includes('!~'));

  if (hasNegative && !hasPositive) {
    const first = filters.find((f) => isNonEmpty(f.tag));
    if (first?.tag) {
      const safeTag = normalizeTag(first.tag);
      parts.unshift(`${safeTag}=~".+"`);
    }
  }

  return `{${parts.join(', ')}}`;
}

function lineStage(f: Filter): string | null {
  if (!MESSAGE_TAGS.has(f.tag)) {
    return null;
  }
  const v = (f.value ?? []).find(isNonEmpty);
  if (!v) {
    return null;
  }
  switch (f.op as Operator) {
    case 'contains':
      return `|= "${esc(v)}"`;
    case 'not contains':
      return `!= "${esc(v)}"`;
    case 'regex':
      return `|~ "${esc(v)}"`;
    case 'not regex':
      return `!~ "${esc(v)}"`;
    default:
      return null;
  }
}

function pipeline(filters: Filter[]): string {
  const stages = filters.map(lineStage).filter(Boolean) as string[];
  return stages.length ? ` ${stages.join(' ')} ` : ' ';
}

export function buildLogQLFromQueryRaw(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '5m'
): string {
  return buildLogQLExpressions(q, window).aggExpr;
}

export function buildLogQLFromQueryRawForUI(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '5m'
): string {
  return buildLogQLExpressionsForUI(q, window).aggExpr;
}

export function buildLogQLExpressions(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '5m'
) {
  return buildLogQLExpressionsInternal(q, window, false);
}

export function buildLogQLExpressionsForUI(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '5m'
) {
  return buildLogQLExpressionsInternal(q, window, true);
}

function buildLogQLExpressionsInternal(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '5m',
  hideHidden = false
) {
  const fs = (q.filters ?? []).filter(Boolean);
  const extractorFields: string[] = ((q as any)?.extractor?.fields ?? [])
    .map((f: any) => (typeof f === 'string' ? f : f?.name || f?.label))
    .filter(isNonEmpty);

  const labelFilters = fs.filter((f) => !extractorFields.includes(f.tag));
  const extractedFilters = fs.filter((f) => extractorFields.includes(f.tag));

  const sel = selector(labelFilters, hideHidden);
  const pipe = pipeline(labelFilters);
  let baseExpr = `${sel}${pipe}`.trim() || '{}';
  const w = normalizeWindow(window);

  let numericStages = '';
  for (const f of labelFilters) {
    if (NUMERIC_AFTER_SELECTOR.has(f.tag) && isComparisonOp(f.op as Operator)) {
      const v = (f.value ?? []).find(isNonEmpty);
      const ms = parseDurationToMs(v);
      if (ms !== null) {
        numericStages += ` | ${normalizeTag(f.tag)} ${f.op} ${ms}`;
      }
    }
  }

  const fieldValuesName =
    typeof q.valueAs === 'string' && q.valueAs.startsWith('field_values:')
      ? q.valueAs.slice('field_values:'.length)
      : '';

  if (isNonEmpty(fieldValuesName)) {
    const unwrapField = normalizeTag(fieldValuesName);
    const rawExtractor =
      (q as any)?.extractor?.logqlRegex ?? (q as any)?.extractor?.regex ?? (q as any)?.extractor?.pattern;
    const extractorRegexes = Array.isArray(rawExtractor) ? rawExtractor : rawExtractor ? [rawExtractor] : [];
    extractorRegexes.forEach((re) => {
      baseExpr += ` | regexp "${esc(re)}" | unwrap ${unwrapField}`;
    });
  } else {
    const rawExtractor =
      (q as any)?.extractor?.logqlRegex ?? (q as any)?.extractor?.regex ?? (q as any)?.extractor?.pattern;
    const extractorRegexes = Array.isArray(rawExtractor) ? rawExtractor : rawExtractor ? [rawExtractor] : [];
    extractorRegexes.forEach((re) => {
      baseExpr += ` | regexp "${esc(re)}"`;
    });
  }

  let extractedStages = '';
  for (const f of extractedFilters) {
    const tag = normalizeTag(f.tag);
    const vals = (f.value ?? []).filter(isNonEmpty);
    const first = vals[0];

    switch (f.op as Operator) {
      case '=':
        if (first) {
          extractedStages += ` | ${tag}="${esc(first)}"`;
        }
        break;
      case '!=':
        if (first) {
          extractedStages += ` | ${tag}!="${esc(first)}"`;
        }
        break;
      case 'in':
        if (vals.length) {
          extractedStages += ` | ${tag}=~"^(?:${vals.map(escRegexAlt).join('|')})$"`;
        }
        break;
      case 'not_in':
        if (vals.length) {
          extractedStages += ` | ${tag}!~"^(?:${vals.map(escRegexAlt).join('|')})$"`;
        }
        break;
      case 'regex':
        if (first) {
          extractedStages += ` | ${tag}=~"${first}"`;
        }
        break;
      case 'not regex':
        if (first) {
          extractedStages += ` | ${tag}!~"${first}"`;
        }
        break;
      case 'contains':
        if (first) {
          extractedStages += ` | ${tag}=~".*${escRegexAlt(first)}.*"`;
        }
        break;
      case 'not contains':
        if (first) {
          extractedStages += ` | ${tag}!~".*${escRegexAlt(first)}.*"`;
        }
        break;
      case 'has':
        extractedStages += ` | ${tag}!=""`;
        break;
      case '<':
      case '<=':
      case '>':
      case '>=':
        if (first) {
          const ms = NUMERIC_AFTER_SELECTOR.has(f.tag) ? parseDurationToMs(first) : Number(first);
          if (ms !== null && Number.isFinite(ms as number)) {
            extractedStages += ` | ${tag} ${f.op} ${ms}`;
          }
        }
        break;
    }
  }

  let preAggExpr = baseExpr + numericStages + extractedStages;
  let valueExpr = preAggExpr;
  let alreadyAggregated = false;

  if (isNonEmpty(fieldValuesName)) {
    if (isNonEmpty(q.logqlAggregation)) {
      switch (q.logqlAggregation) {
        case 'sum':
          valueExpr = `sum_over_time(${preAggExpr}[${w}])`;
          alreadyAggregated = true;
          break;
        case 'min':
          valueExpr = `min_over_time(${preAggExpr}[${w}])`;
          alreadyAggregated = true;
          break;
        case 'max':
          valueExpr = `max_over_time(${preAggExpr}[${w}])`;
          alreadyAggregated = true;
          break;
        case 'avg':
          valueExpr = `avg_over_time(${preAggExpr}[${w}])`;
          alreadyAggregated = true;
          break;
        default:
          valueExpr = `${q.logqlAggregation}(${preAggExpr}[${w}])`;
          alreadyAggregated = true;
          break;
      }
    } else {
      valueExpr = `rate_counter(${preAggExpr}[${w}])`;
    }
  } else if (q.valueAs === 'rates_per_second' || q.valueAs === 'count_over_time' || q.valueAs === 'last_over_time') {
    valueExpr =
      q.valueAs === 'rates_per_second'
        ? `rate(${preAggExpr}[${w}])`
        : q.valueAs === 'count_over_time'
        ? `count_over_time(${preAggExpr}[${w}])`
        : `last_over_time(${preAggExpr}[${w}])`;
  }

  const gb = (q.groupBy ?? []).filter(isNonEmpty).map(normalizeTag);
  const by = gb.length ? ` by (${gb.join(',')})` : '';

  let aggExpr = valueExpr;
  if (!alreadyAggregated && isNonEmpty(q.logqlAggregation)) {
    aggExpr = `${q.logqlAggregation}${by}(${valueExpr})`;
  } else if (!isNonEmpty(q.logqlAggregation)) {
    const isRateOrCountOrLast =
      q.valueAs === 'rates_per_second' || q.valueAs === 'count_over_time' || isNonEmpty(fieldValuesName);
    if (gb.length && isRateOrCountOrLast) {
      aggExpr = `sum${by}(${valueExpr})`;
    }
  }

  return { filtersExpr: preAggExpr, valueExpr, aggExpr };
}

type PlanKind = 'pure' | 'aggregated';
type PlanRole = 'filter' | 'wrapped' | 'none';
export type LogQLPlan = { expr: string; kind: PlanKind; role: PlanRole };

const AGG_FUNCS = [
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'rate',
  'increase',
  'count_over_time',
  'sum_over_time',
  'min_over_time',
  'max_over_time',
  'avg_over_time',
  'rate_counter',
  'last_over_time',
];

function looksAggregated(expr: string): boolean {
  return AGG_FUNCS.some((fn) => expr.includes(fn + '('));
}

export function buildLogQLPlans(
  q: Pick<MyQuery, 'filters' | 'valueAs' | 'logqlAggregation' | 'groupBy' | 'extractor'>,
  window = '10s'
): LogQLPlan[] {
  const { filtersExpr, aggExpr } = buildLogQLExpressions(q, window);
  const hasExplicitAgg = isNonEmpty((q as any).logqlAggregation);
  const hasGroupBy = (q.groupBy ?? []).some(isNonEmpty);
  const hasValueAs = !!q.valueAs;
  if (hasExplicitAgg || (hasGroupBy && hasValueAs) || looksAggregated(aggExpr)) {
    return [{ expr: aggExpr, kind: 'aggregated', role: 'none' }];
  }
  const w = normalizeWindow(window);
  const wrapped = `sum(count_over_time(${filtersExpr}[${w}]))`;
  return [
    { expr: filtersExpr, kind: 'pure', role: 'filter' },
    { expr: wrapped, kind: 'pure', role: 'wrapped' },
  ];
}
