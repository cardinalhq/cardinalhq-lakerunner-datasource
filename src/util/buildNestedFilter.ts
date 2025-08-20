import type { Filter } from '../types';

const USER_LABEL_TO_INTERNAL: Record<string, string> = {
  message: '_cardinalhq.message',
  level: '_cardinalhq.level',
};

function mapToInternalLabel(label: string): string {
  return USER_LABEL_TO_INTERNAL[label] || label;
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

  const convertOp = (op: string | undefined): string => {
    switch (op) {
      case '=':
        return 'eq';
      case '!=':
        return 'neq';
      case 'in':
        return 'in';
      case 'not_in':
        return 'not_in';
      case 'contains':
        return 'contains';
      case 'not contains':
        return 'not_contains';
      case 'regex':
        return 'regex';
      case 'not regex':
        return 'not_regex';
      case 'has':
        return 'has';
      default:
        return 'eq';
    }
  };

  const convertFilter = (f: Filter) => {
    const k = mapToInternalLabel(f.tag);
    const extractedType = extractedByInternalName.get(k);

    return {
      k,
      v: f.value,
      op: convertOp(f.op),
      dataType: (f.dataType as 'string' | 'number') || extractedType || 'string',
      extracted: f.extracted !== undefined ? !!f.extracted : extractedByInternalName.has(k),
      computed: !!f.computed,
    };
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
