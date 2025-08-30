import { toInternalLabel } from 'services/logs';
import { Filter, MyQuery } from 'types';
import { buildNestedFilter } from './buildNestedFilter';

export function buildASTInput(target: MyQuery) {
  const isPromql = target.mode === 'promQL';
  const isMetrics = target.mode === 'metrics' || isPromql;
  const isTrace = target.mode === 'traces';
  const hasMetricName = !!target.metricName;
  const isLogVolumeQuery = target.queryText === 'volume';

  const rawFilters: Filter[] = target.filters ?? [];

  const filters: Filter[] = rawFilters.filter((f) => {
    const isKeyValid = f.tag?.trim();
    const isValueValid = Array.isArray(f.value) && f.value.some((v) => v?.trim?.());
    return isKeyValid && isValueValid;
  });

  const hasEqualityScope = filters.some((f) => (f.op === '=' || f.op === 'in') && String(f.tag || '').trim() !== '');

  if (!isMetrics && !hasEqualityScope) {
    filters.push({
      tag: 'resource.service.name',
      op: 'has',
      value: [''],
    });
  }

  if (isMetrics && !hasMetricName) {
    return [];
  }
  const groupBy: string[] = isLogVolumeQuery ? [toInternalLabel('level')] : (target.groupBy ?? []).map(toInternalLabel);

  if (isMetrics && target.metricName) {
    filters.unshift({
      tag: '_cardinalhq.name',
      op: '=',
      value: [target.metricName],
    });
  }
  if (target.selectedFingerprint && target.extractor) {
    const alreadyHasFp = filters.some((f) => toInternalLabel(f.tag || '') === '_cardinalhq.fingerprint');
    if (!alreadyHasFp) {
      filters.unshift({
        tag: '_cardinalhq.fingerprint',
        op: '=',
        value: [String(target.selectedFingerprint)],
        dataType: 'string',
        extracted: false,
        computed: false,
      });
    }
  }

  let allFilters = [...filters];

  if (target.extractor?.selections?.length) {
    const selected = target.extractor.selections.filter((sel) => sel.label && sel.userSelected);
    const byInternal = new Map(selected.map((sel) => [toInternalLabel(sel.label), sel.dataType]));

    const patchedFilters = filters.map((f) => {
      const k = toInternalLabel(f.tag);
      const t = byInternal.get(k);
      return t ? { ...f, dataType: t, extracted: true } : f;
    });

    const present = new Set(patchedFilters.map((f) => toInternalLabel(f.tag)));
    const additional: Filter[] = selected
      .filter((sel) => !present.has(toInternalLabel(sel.label)))
      .map((sel) => ({
        tag: sel.label,
        op: 'has',
        value: [''],
        dataType: sel.dataType,
        extracted: true,
        computed: false,
      }));

    allFilters = [...patchedFilters, ...additional];
  }

  let nestedFilter = buildNestedFilter(allFilters);

  if (!nestedFilter && !isMetrics) {
    nestedFilter = {
      k: 'resource.service.name',
      v: [''],
      op: 'has',
      dataType: 'string',
      extracted: false,
      computed: false,
    } as any;
  }

  const dataset = isMetrics ? 'metrics' : isTrace ? 'traces' : 'logs';
  const expression: any = {
    dataset,
    returnResults: true,
    filter: nestedFilter,
  };
  if (target.extractor && Array.isArray(target.extractor.selections) && Array.isArray(target.extractor.fields)) {
    expression.extract = {
      regex: target.extractor.regex,
      fields: target.extractor.selections.map((sel, i) => ({
        name: target.extractor!.fields[i] || `var_${i + 1}`,
        type: sel.dataType,
      })),
    };
  }

  if (isMetrics && target.metricType) {
    expression.metricType = target.metricType;
  }

  const hasExtractor = !!target.extractor?.regex && Array.isArray(target.extractor.fields);
  const chartField = target.chartField;
  const chartAggregation = target.chartAggregation ?? 'sum';
  const normalAggregation = target.aggregation ?? 'sum';

  const hasNumericChartField =
    hasExtractor &&
    chartField &&
    target.extractor?.selections?.some((sel) => sel.label === chartField && sel.dataType === 'number');

  if (isMetrics) {
    const metricType = target.metricType;
    const valueAs = target.valueAs ?? (metricType === 'count' ? 'counts' : 'values');
    const effAggregation = metricType === 'count' ? 'sum' : normalAggregation;
    const effRollup = metricType === 'count' ? 'avg' : normalAggregation;
    const effType = metricType === 'count' ? (valueAs === 'rates_per_second' ? 'rate' : 'count') : 'count';

    expression.chart = {
      aggregation: effAggregation,
      rollup: effRollup,
      groupBys: groupBy,
      type: effType,
    };
  } else if (isTrace) {
    expression.chart = {
      aggregation: normalAggregation,
      rollup: normalAggregation,
      groupBys: groupBy,
      type: 'count',
    };
  } else if (isLogVolumeQuery) {
    expression.chart = {
      aggregation: normalAggregation,
      rollup: normalAggregation,
      groupBys: groupBy,
      type: 'count',
    };
  } else if (hasNumericChartField || groupBy.length > 0) {
    const selected = hasNumericChartField
      ? target.extractor!.selections.find((sel) => sel.label === chartField && sel.dataType === 'number')
      : undefined;

    expression.chart = {
      aggregation: hasNumericChartField ? chartAggregation : normalAggregation,
      rollup: hasNumericChartField ? chartAggregation : normalAggregation,
      groupBys: groupBy,
      type: 'count',
      ...(hasNumericChartField ? { fieldName: chartField, fieldType: selected?.dataType ?? 'number' } : {}),
    };
  }

  const astInput = {
    baseExpressions: {
      a: expression,
    },
  };

  return astInput;
}
