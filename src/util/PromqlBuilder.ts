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

function normalizedLabel(labelName: string): string {
  const trimmed = (labelName || '').trim();
  return trimmed.includes('.') ? `"${trimmed}"` : trimmed;
}

function quote(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderClause(k: string, op: FilterOp, v: string | string[] | undefined): string {
  const key = normalizedLabel(k);

  switch (op) {
    case 'eq':
      return `${key}=${quote(String(v))}`;
    case 'neq':
      return `${key}!=${quote(String(v))}`;
    case 'regex':
    case 'contains':
    case 'in': {
      const rx = String(v ?? '');
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}=~${quoted}`;
    }
    case 'not_regex':
    case 'not_contains':
    case 'not_in': {
      const rx = String(v ?? '');
      const quoted = rx.startsWith('"') && rx.endsWith('"') ? rx : quote(rx);
      return `${key}!~${quoted}`;
    }
    default:
      return `${key}=${quote(String(v))}`;
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
        selectors.push(renderClause(node.k, node.op, node.v ?? ''));
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

  const labels = selectors.length ? `{${selectors.join(',')}}` : '';
  const inner = `${metricName}${labels}`;

  const series = (metricType || '').toLowerCase() === 'counter' ? `rate(${inner}[${rateWindow}])` : inner;

  const agg = renderAgg(chart?.aggregation);
  const by = renderGroupBy(chart?.groupBys);

  return agg ? `${agg}${by}(${series})` : series;
}
