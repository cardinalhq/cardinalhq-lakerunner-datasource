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
import { DataSource } from '../datasource';
import { useTags } from '../hooks/useTagKeys';
import { FilterBuilder } from './FilterTags';
import { PrismPromQLEditor } from './PrismEditor';
import { buildLogQLFromQueryRaw, buildLogQLFromQueryRawForUI, buildLogQLExpressions } from '../util/LogqlBuilder';
import { getSelectedTraceId } from '../services/traces';

interface Props {
  datasourceUid: string;
  datasource: DataSource;
  query: MyQuery;
  onChange: (q: MyQuery) => void;
  onRunQuery: () => void;
  timeRange?: { startTime: number | undefined; endTime: number | undefined };
  labelsRefreshKey?: number;
  onLabelsRefresh?: () => void;
}

const HIDDEN_TAGS = new Set<string>(['fingerprint', '_cardinalhq.fingerprint', '_cardinalhq_fingerprint']);
const isHiddenTag = (t?: string) => !!t && HIDDEN_TAGS.has(t.replace(/^"|"$/g, ''));

export default function TracesTab({ datasourceUid, query, onChange, timeRange, labelsRefreshKey = 0 }: Props) {
  const subTab = (query.tracesSubTab as 'builder' | 'code') ?? 'builder';

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const stableFiltersForLabels = useMemo(
    () => (query.filters ?? []).filter((f) => !!f.tag && !isHiddenTag(f.tag) && !TEXT_OPERATORS.includes(f.op)),
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
    datasourceUid,
    startTime: query.timeFrom,
    endTime: query.timeTo,
    enabled: query.mode === 'traces',
    filters: stableFiltersForLabels,
    expr: tagsFilterExpr,
    refreshKey: labelsRefreshKey,
    mode: 'traces',
  });

  const mergedTags = useMemo(() => (tags ?? []).filter((t) => !isHiddenTag(t)), [tags]);
  const visibleFilters = useMemo(() => (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)), [query.filters]);
  const effectiveTimeRange = timeRange || { startTime: query.timeFrom, endTime: query.timeTo };
  const isTraceDetail = Boolean(getSelectedTraceId(query.filters ?? []));

  const builderExpr = useMemo(() => {
    const buildInput = {
      filters: (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)),
      valueAs: query.valueAs,
      logqlAggregation: query.aggregation,
      groupBy: query.groupBy,
      extractor: query.extractor,
    };
    return buildLogQLFromQueryRaw(buildInput as any) || '{}';
  }, [query.filters, query.valueAs, query.aggregation, query.groupBy, query.extractor]);

  const builderExprForUI = useMemo(() => {
    const buildInput = {
      filters: (query.filters ?? []).filter((f) => !isHiddenTag(f.tag)),
      valueAs: query.valueAs,
      logqlAggregation: query.aggregation,
      groupBy: query.groupBy,
      extractor: query.extractor,
    };
    return buildLogQLFromQueryRawForUI(buildInput as any) || '{}';
  }, [query.filters, query.valueAs, query.aggregation, query.groupBy, query.extractor]);

  const [codeDraft, setCodeDraft] = useState<string>(query.tracesOutput ?? '');

  const prevDsRef = useRef(datasourceUid);
  useEffect(() => {
    if (prevDsRef.current !== datasourceUid) {
      prevDsRef.current = datasourceUid;
      onChangeRef.current({
        ...query,
        tracesSubTab: 'builder',
        tracesActive: 'builder',
        tracesOutput: undefined,
        tracesEdited: false,
        tracesBuilderExp: undefined,
        builderFields: [],
        codeFields: [],
      });
      setCodeDraft('');
    }
  }, [datasourceUid, query]);

  useEffect(() => {
    if (subTab === 'builder' && builderExpr !== query.tracesBuilderExp) {
      onChangeRef.current({
        ...query,
        tracesSubTab: 'builder',
        tracesActive: 'builder',
        tracesBuilderExp: builderExpr,
      });
    }
  }, [subTab, builderExpr, query]);

  useEffect(() => {
    if (subTab !== 'code' || query.tracesEdited) {
      return;
    }
    setCodeDraft((prev) => {
      if (prev === builderExprForUI) {
        return prev;
      }
      const next = builderExprForUI;
      onChangeRef.current({ ...query, tracesSubTab: 'code', tracesActive: 'code', tracesOutput: next });
      return next;
    });
  }, [subTab, builderExprForUI, query]);

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
                    ...query,
                    tracesSubTab: 'builder',
                    tracesActive: 'builder',
                    tracesOutput: undefined,
                  });
                } else {
                  const seed = query.tracesEdited ? query.tracesOutput ?? codeDraft : builderExprForUI;
                  setCodeDraft(seed ?? '');
                  onChangeRef.current({
                    ...query,
                    tracesSubTab: 'code',
                    tracesActive: 'code',
                    tracesOutput: seed ?? '',
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
            datasourceUid={datasourceUid}
            tags={mergedTags}
            loadingTags={loading}
            filters={visibleFilters.length ? visibleFilters : [{ tag: '', op: '=', value: [''] }]}
            onFiltersChange={(filters: any) => onChangeRef.current({ ...query, filters })}
            groupBy={query.groupBy ?? []}
            onGroupByChange={(gb: any) => onChangeRef.current({ ...query, groupBy: gb })}
            mode="traces"
            aggregation={query.aggregation}
            onAggregationChange={(agg: any) => onChangeRef.current({ ...query, aggregation: agg })}
            onAggregationDelete={() => onChangeRef.current({ ...query, aggregation: undefined })}
            valueAs={query.valueAs}
            onValueAsChange={(v: any) => onChangeRef.current({ ...query, valueAs: v })}
            onValueAsDelete={() => onChangeRef.current({ ...query, valueAs: undefined })}
            extractor={query.extractor}
            selectedFingerprint={query.selectedFingerprint}
            startTime={effectiveTimeRange.startTime}
            endTime={effectiveTimeRange.endTime}
            fields={query.builderFields ?? []}
            onFieldsChange={(fields: string[]) => onChangeRef.current({ ...query, builderFields: fields })}
            disableDefaults={isTraceDetail}
          />
          <div style={{ marginTop: 8 }}>
            <PrismPromQLEditor value={builderExprForUI} language="logql" height={40} width="100%" wordWrap />
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
                const next = String(val ?? '');
                setCodeDraft(next);
                onChangeRef.current({
                  ...query,
                  tracesSubTab: 'code',
                  tracesActive: 'code',
                  tracesOutput: next,
                  tracesEdited: true,
                });
              }}
              onBlur={() => {
                if ((query.tracesOutput ?? '') !== codeDraft) {
                  onChangeRef.current({
                    ...query,
                    tracesSubTab: 'code',
                    tracesActive: 'code',
                    tracesOutput: codeDraft,
                    tracesEdited: true,
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
