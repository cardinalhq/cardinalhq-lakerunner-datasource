import type { Filter } from '../types';

const USER_LABEL_TO_INTERNAL: Record<string, string> = {
  message: '_cardinalhq.message',
  level: '_cardinalhq.level',
};

function mapToInternalLabel(label: string): string {
  return USER_LABEL_TO_INTERNAL[label] || label;
}

export function buildNestedFilter(filters: Filter[]): any {
  if (!filters || filters.length === 0) {
    return undefined;
  }

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

  const convertFilter = (f: Filter) => ({
    k: mapToInternalLabel(f.tag),
    v: f.value,
    op: convertOp(f.op),
    dataType: f.dataType || 'string',
    extracted: !!f.extracted,
    computed: !!f.computed,
  });

  if (filters.length === 1) {
    return convertFilter(filters[0]);
  }

  const filterBlock: Record<string, any> = {
    op: 'and',
  };

  filters.forEach((f, idx) => {
    filterBlock[`q${idx + 1}`] = convertFilter(f);
  });

  return filterBlock;
}
