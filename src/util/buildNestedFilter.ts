import type { Filter } from '../types';

export function buildNestedFilter(filters: Filter[]): any {
  if (!filters || filters.length === 0) {
    return undefined;
  }

  const convertOp = (op: string) => {
    switch (op) {
      case '=':
        return 'eq';
      case '!=':
        return 'neq';
      case 'in':
        return 'in';
      case 'not_in':
        return 'not_in';
      default:
        return 'eq';
    }
  };

  if (filters.length === 1) {
    const { tag, value, op } = filters[0];
    return {
      k: tag,
      v: value,
      op: convertOp(op),
      dataType: 'string',
      extracted: false,
      computed: false,
    };
  }

  const out: any = { op: 'and' };
  filters.forEach((f, i) => {
    out[`q${i + 1}`] = {
      k: f.tag,
      v: f.value,
      op: convertOp(f.op),
      dataType: 'string',
      extracted: false,
      computed: false,
    };
  });

  return out;
}
