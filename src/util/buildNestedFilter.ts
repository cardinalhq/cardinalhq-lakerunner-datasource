import type { Filter } from '../types';

const USER_LABEL_TO_INTERNAL: Record<string, string> = {
  message: '_cardinalhq.message',
  level: '_cardinalhq.level',
};

function mapToInternalLabel(label: string): string {
  const key = String(label ?? '');
  return USER_LABEL_TO_INTERNAL[key] || key;
}

type ExtractSpec = {
  regex: string;
  fields: Array<{ name: string; type: 'string' | 'number' }>;
};

export function buildNestedFilter(filters: Filter[], extract?: ExtractSpec): any {
  if (!filters || filters.length === 0) {
    return undefined;
  }

  const extractedByInternalName = new Map<string, 'string' | 'number'>(
    (extract?.fields ?? []).map(({ name, type }) => [mapToInternalLabel(name), type])
  );

  const norm = (s?: string) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const NEGATIVE_OPS = new Set(['!=', 'not in', 'not contains', 'not regex']);

  const convertOp = (raw: string | undefined): string => {
    const op = norm(raw);
    switch (op) {
      case '=':
      case '!=':
        return 'eq';
      case 'in':
      case 'not in':
        return 'in';
      case 'contains':
      case 'not contains':
        return 'contains';
      case 'regex':
      case 'not regex':
        return 'regex';
      case 'has':
        return 'has';
      case '>':
        return 'gt';
      case '<':
        return 'lt';
      case '>=':
        return 'ge';
      case '<=':
        return 'le';
      default:
        return 'eq';
    }
  };

  const isNegative = (raw: string | undefined) => NEGATIVE_OPS.has(norm(raw));

  const convertFilter = (f: Filter) => {
    const k = mapToInternalLabel(f.tag);
    const extractedType = extractedByInternalName.get(k);
    const base = {
      k,
      v: f.value,
      op: convertOp(f.op),
      dataType: (f.dataType as 'string' | 'number') || extractedType || 'string',
      extracted: f.extracted !== undefined ? !!f.extracted : extractedByInternalName.has(k),
      computed: !!f.computed,
    };
    return isNegative(f.op) ? { not: base } : base;
  };

  if (filters.length === 1) {
    return convertFilter(filters[0]);
  }

  const block: Record<string, any> = { op: 'and' };
  filters.forEach((f, idx) => {
    block[`q${idx + 1}`] = convertFilter(f);
  });
  return block;
}
