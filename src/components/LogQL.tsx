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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { InlineFieldRow, Tab, TabsBar } from '@grafana/ui';
import { MyQuery, TEXT_OPERATORS } from '../types';
import { useTags } from '../hooks/useTagKeys';
import { PrismPromQLEditor } from './PrismEditor';
import { buildLogQLFromQueryRaw, buildLogQLFromQueryRawForUI, buildLogQLExpressions } from '../util/LogqlBuilder';
import { DataSource } from '../datasource';
import { toInternalLabel } from '../services/tags';
import { withHiddenFingerprint } from '../util/buildFinalLogQL';
import { FilterBuilder } from './FilterTags';

interface Props {
  datasourceId: number;
  datasource: DataSource;
  query: MyQuery;
  onChange: (q: MyQuery) => void;
  onRunQuery: () => void;
  timeRange?: { startTime: number | undefined; endTime: number | undefined };
  labelsRefreshKey?: number;
  onLabelsRefresh?: () => void;
}

const HIDDEN_TAGS = new Set<string>(['fingerprint', 'chq_fingerprint', '_cardinalhq_fingerprint']);
const isHiddenTag = (t?: string) => !!t && HIDDEN_TAGS.has(t.replace(/^"|"$/g, ''));
const MESSAGE_TAG = 'log_message';
const SERVICE_NAME_TAG = 'resource_service_name';

export function LogQLTab({
  datasourceId,
  datasource,
  query,
  onChange,
  onRunQuery,
  timeRange,
  labelsRefreshKey = 0,
  onLabelsRefresh,
}: Props) {
  const subTab = (query.logqlSubTab as 'builder' | 'code') ?? 'builder';

  const stableFiltersForLabels = useMemo(
    () =>
      (query.filters ?? []).filter(
        (f) => !!f.tag && f.tag !== MESSAGE_TAG && !TEXT_OPERATORS.includes(f.op) && !isHiddenTag(f.tag)
      ),
    [query.filters]
  );

  // Build expression for scoping available tags based on current filters
  const tagsFilterExpr = useMemo(() => {
    // Only use complete filters (tag + values) for scoping
    const completeFilters = stableFiltersForLabels.filter(
      (f) => f.tag?.trim() && Array.isArray(f.value) && f.value.some((v) => v?.trim?.())
    );
    if (completeFilters.length === 0) {
      return undefined;
    }
    const { filtersExpr } = buildLogQLExpressions({ filters: completeFilters });
    return filtersExpr && filtersExpr !== '{}' ? filtersExpr : undefined;
  }, [stableFiltersForLabels]);

  const { data: tags, loading } = useTags({
    datasourceId,
    startTime: query.timeFrom,
    endTime: query.timeTo,
    enabled: true,
    filters: stableFiltersForLabels,
    expr: tagsFilterExpr,
    refreshKey: labelsRefreshKey,
  });

  const builderExpr = useMemo(() => {
    const buildInput = {
      filters: (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)),
      valueAs: query.valueAs,
      logqlAggregation: query.logqlAggregation,
      groupBy: query.groupBy,
      extractor: query.extractor,
    };
    return buildLogQLFromQueryRaw(buildInput as any) || '{}';
  }, [query.filters, query.valueAs, query.logqlAggregation, query.groupBy, query.extractor]);

  const builderExprForUI = useMemo(() => {
    const buildInput = {
      filters: (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)),
      valueAs: query.valueAs,
      logqlAggregation: query.logqlAggregation,
      groupBy: query.groupBy,
      extractor: query.extractor,
    };
    return buildLogQLFromQueryRawForUI(buildInput as any) || '{}';
  }, [query.filters, query.valueAs, query.logqlAggregation, query.groupBy, query.extractor]);

  const selectorWithFingerprint = useMemo(() => {
    let expr = builderExpr || '{}';
    if (query.selectedFingerprint) {
      expr = withHiddenFingerprint(expr, query.selectedFingerprint);
    }
    return expr;
  }, [builderExpr, query.selectedFingerprint]);

  const finalExprBuilder = useMemo(() => selectorWithFingerprint || '{}', [selectorWithFingerprint]);
  const finalExprForUI = useMemo(() => builderExprForUI || '{}', [builderExprForUI]);

  const [codeDraft, setCodeDraft] = useState<string>(query.logqlOutput ?? '');
  const prevDsRef = useRef(datasourceId);

  useEffect(() => {
    if (prevDsRef.current !== datasourceId) {
      prevDsRef.current = datasourceId;
      onChangeRef.current({
        ...queryRef.current,
        logqlOutput: undefined,
        logqlEdited: false,
        logqlSubTab: 'builder',
        logqlBuilderExp: undefined,
        builderFields: [],
        codeFields: [],
        filters: [],
        groupBy: queryRef.current.groupBy ?? [],
        extractor: undefined,
      });

      setCodeDraft('');
    }
  }, [datasourceId]);

  const groupByRef = useRef<string[]>(query.groupBy ?? []);
  useEffect(() => {
    groupByRef.current = query.groupBy ?? [];
  }, [query.groupBy]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (subTab === 'builder') {
      if (finalExprBuilder !== query.logqlBuilderExp) {
        onChangeRef.current({
          ...queryRef.current,
          groupBy: groupByRef.current,
          logqlSubTab: 'builder',
          logqlBuilderExp: finalExprBuilder,
          logqlEdited: false,
        });
      }
    }
  }, [subTab, finalExprBuilder, query.logqlBuilderExp]);

  useEffect(() => {
    if (subTab !== 'code' || query.logqlEdited) {
      return;
    }

    setCodeDraft((prev) => {
      if (prev === finalExprForUI) {
        return prev;
      }
      const nextQuery: MyQuery = {
        ...queryRef.current,
        groupBy: groupByRef.current,
        logqlSubTab: 'code' as 'code',
        logqlOutput: finalExprForUI,
      };
      onChangeRef.current(nextQuery);
      return finalExprForUI;
    });
  }, [subTab, finalExprForUI, query.logqlEdited]);

  const mergedTags = useMemo(() => {
    const baseTags = (tags ?? []).filter((t) => !isHiddenTag(t));
    const extracted = (query.extractor?.fields ?? [])
      .map((f: any) => (typeof f === 'string' ? f : f?.name))
      .filter((n): n is string => !!n && !n.startsWith('var_'))
      .map(toInternalLabel)
      .filter((t) => !isHiddenTag(t));
    return Array.from(new Set([...baseTags, ...extracted]));
  }, [tags, query.extractor?.fields]);

  const visibleFilters = useMemo(() => (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)), [query.filters]);
  const effectiveTimeRange = timeRange || { startTime: query.timeFrom, endTime: query.timeTo };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <TabsBar>
          {(['builder', 'code'] as const).map((t) => (
            <Tab
              key={t}
              label={t === 'builder' ? 'Builder' : 'Code'}
              active={subTab === t}
              onChangeTab={() => {
                if (t === 'builder') {
                  onChangeRef.current({
                    ...queryRef.current,
                    groupBy: groupByRef.current,
                    logqlSubTab: 'builder',
                  });
                } else {
                  const seed = query.logqlEdited ? query.logqlOutput ?? '' : finalExprForUI;
                  setCodeDraft(seed);
                  onChangeRef.current({
                    ...queryRef.current,
                    groupBy: groupByRef.current,
                    logqlSubTab: 'code',
                    logqlOutput: seed,
                  });
                }
              }}
            />
          ))}
        </TabsBar>
      </div>

      {subTab === 'builder' && (
        <>
          <FilterBuilder
            datasourceId={datasourceId}
            tags={mergedTags}
            loadingTags={loading}
            filters={visibleFilters.length ? visibleFilters : [{ tag: SERVICE_NAME_TAG, op: '=', value: [''] }]}
            onFiltersChange={(filters: any) => {
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, filters });
            }}
            groupBy={groupByRef.current}
            onGroupByChange={(gb: string[]) => {
              groupByRef.current = gb;
              onChangeRef.current({ ...queryRef.current, groupBy: gb });
            }}
            aggregation={query.logqlAggregation}
            onAggregationChange={(agg: any) => {
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, logqlAggregation: agg });
            }}
            onAggregationDelete={() =>
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, logqlAggregation: undefined })
            }
            valueAs={query.valueAs}
            onValueAsChange={(v: any) =>
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, valueAs: v })
            }
            onValueAsDelete={() =>
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, valueAs: undefined })
            }
            extractor={query.extractor}
            selectedFingerprint={query.selectedFingerprint}
            startTime={effectiveTimeRange.startTime}
            endTime={effectiveTimeRange.endTime}
            fields={query.builderFields ?? []}
            onFieldsChange={(fields: string[]) =>
              onChangeRef.current({ ...queryRef.current, groupBy: groupByRef.current, builderFields: fields })
            }
          />

          <div style={{ marginTop: 8 }}>
            <PrismPromQLEditor value={finalExprForUI} language="logql" height={40} width="100%" wordWrap />
          </div>
        </>
      )}

      {subTab === 'code' && (
        <div>
          <InlineFieldRow>
            <PrismPromQLEditor
              value={codeDraft}
              language="logql"
              height={40}
              width="100%"
              wordWrap
              onChange={(val: any) => {
                const next = val ?? '';
                setCodeDraft(next);
                onChangeRef.current({
                  ...queryRef.current,
                  groupBy: groupByRef.current,
                  logqlSubTab: 'code',
                  logqlOutput: next,
                  logqlEdited: true,
                });
              }}
              onBlur={() => {
                if ((query.logqlOutput ?? '') !== codeDraft) {
                  onChangeRef.current({
                    ...queryRef.current,
                    groupBy: groupByRef.current,
                    logqlSubTab: 'code',
                    logqlOutput: codeDraft,
                    logqlEdited: true,
                  });
                }
              }}
            />
          </InlineFieldRow>
        </div>
      )}
    </div>
  );
}
