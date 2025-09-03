type FilterOp = 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'not_contains' | 'regex' | 'not_regex';

export type GraphPayload = {
  baseExpressions: {
    [k: string]: {
      dataset?: 'logs' | 'metrics';
      metricType?: 'gauge' | 'counter' | string;
      returnResults?: boolean;
      filter?: any;
      chart?: {
        aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'stddev' | 'stdvar';
        rollup?: string;
        groupBys?: string[];
        type?: string;
      };
    };
  };
};

const DEFAULT_RATE_WINDOW = '5m';

function rawMetricName(name: string): string {
  return (name || '').trim();
}

function isValidPromMetricName(name: string): boolean {
  return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name);
}

function normalizedLabel(labelName: string): string {
  const trimmed = (labelName || '').trim();
  return trimmed.includes('.') ? `"${trimmed}"` : trimmed;
}

function quote(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toRegexAlternation(values: string[], wrap: 'exact' | 'contains'): string {
  const parts = values.map(escapeRegexLiteral);
  if (wrap === 'exact') {
    return `^(?:${parts.join('|')})$`;
  }
  return `.*(?:${parts.join('|')}).*`;
}

function renderClause(k: string, op: FilterOp, v: string | string[] | undefined): string {
  const key = normalizedLabel(k);

  const ensureString = (val: string | string[] | undefined): string => {
    if (Array.isArray(val)) {
      return val.join(',');
    }
    return String(val ?? '');
  };

  switch (op) {
    case 'eq':
      return `${key}=${quote(ensureString(v))}`;
    case 'neq':
      return `${key}!=${quote(ensureString(v))}`;

    case 'regex': {
      const rx = ensureString(v);
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}=~${quoted}`;
    }
    case 'not_regex': {
      const rx = ensureString(v);
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}!~${quoted}`;
    }

    // Treat "in" as exact-match alternation
    case 'in': {
      const vals = Array.isArray(v) ? v : [ensureString(v)];
      const rx = toRegexAlternation(vals, 'exact');
      return `${key}=~${quote(rx)}`;
    }
    case 'not_in': {
      const vals = Array.isArray(v) ? v : [ensureString(v)];
      const rx = toRegexAlternation(vals, 'exact');
      return `${key}!~${quote(rx)}`;
    }

    // Treat "contains" as substring alternation
    case 'contains': {
      const vals = Array.isArray(v) ? v : [ensureString(v)];
      const rx = toRegexAlternation(vals, 'contains');
      return `${key}=~${quote(rx)}`;
    }
    case 'not_contains': {
      const vals = Array.isArray(v) ? v : [ensureString(v)];
      const rx = toRegexAlternation(vals, 'contains');
      return `${key}!~${quote(rx)}`;
    }

    default:
      return `${key}=${quote(ensureString(v))}`;
  }
}

function extractMetricAndLabels(filterBlock: any): {
  metricName: string | null;
  selectors: string[];
} {
  if (!filterBlock || typeof filterBlock !== 'object') {
    return { metricName: null, selectors: [] };
  }

  const selectors: string[] = [];
  let metricName: string | null = null;

  const walk = (node: any) => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.k && node.op) {
      if (node.k === '_cardinalhq.name' && node.op === 'eq' && Array.isArray(node.v) && node.v[0]) {
        metricName = rawMetricName(node.v[0]);
      } else {
        selectors.push(renderClause(node.k, node.op as FilterOp, node.v ?? ''));
      }
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === 'op') {
        continue;
      }
      walk(v);
    }
  };

  walk(filterBlock);
  return { metricName, selectors };
}

function renderAgg(agg?: string): string | null {
  if (!agg) {
    return null;
  }
  const ok = new Set(['sum', 'avg', 'min', 'max', 'count', 'stddev', 'stdvar']);
  const a = agg.toLowerCase();
  return ok.has(a) ? a : null;
}

function renderGroupBy(groupBys?: string[]): string {
  if (!Array.isArray(groupBys) || !groupBys.length) {
    return '';
  }
  const quotedGroupBys = groupBys.map((gb) => normalizedLabel(gb));
  return ` by (${quotedGroupBys.join(',')})`;
}

export function promqlFromGraphPayload(
  payload: GraphPayload,
  opts: { defaultRateWindow?: string } = {}
): string | null {
  const rateWindow = opts.defaultRateWindow || DEFAULT_RATE_WINDOW;

  const base =
    Object.values(payload.baseExpressions || {}).find((b) => b?.returnResults) ||
    Object.values(payload.baseExpressions || {})[0];

  if (!base) {
    return null;
  }

  const { metricType, filter, chart } = base;
  const { metricName, selectors } = extractMetricAndLabels(filter);
  if (!metricName) {
    return null;
  }

  const useNameMatcher = !isValidPromMetricName(metricName);
  const selectorsWithName = useNameMatcher ? [`__name__=${quote(metricName)}`, ...selectors] : selectors;

  const labelBlock = selectorsWithName.length ? `{${selectorsWithName.join(',')}}` : '';

  const inner = useNameMatcher ? `${labelBlock}` : `${metricName}${labelBlock}`;

  const series = (metricType || '').toLowerCase() === 'counter' ? `rate(${inner}[${rateWindow}])` : inner;

  const agg = renderAgg(chart?.aggregation);
  const by = renderGroupBy(chart?.groupBys);

  return agg ? `${agg}${by}(${series})` : series;
}
