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

import React, { useMemo, useState } from 'react';
import { InlineField, InlineFieldRow, Combobox, Input, Button, IconButton } from '@grafana/ui';
import { Filter, Operator } from '../types';
import { FilterRow } from './FilterRowLogQL';
import { useTags } from '../hooks/useTagKeys';
import { promqlFromQueryBuilder } from '../util/MetricsBuilder';

const ERROR_TAG = 'span_status_code';
const DURATION_TAG = 'span_duration';

export function FilterBuilder(props: any) {
  const {
    datasourceId,
    filters,
    onFiltersChange,
    groupBy,
    onGroupByChange,
    aggregation,
    onAggregationChange,
    onAggregationDelete,
    valueAs,
    onValueAsChange,
    onValueAsDelete,
    startTime,
    endTime,
    selectedFingerprint,
    mode = 'logs',
    metricName,
    metricType,
    metricAggregation,
    onMetricAggregationChange,
    onMetricAggregationDelete,
    metricValueAs,
    onMetricValueAsChange,
    onMetricValueAsDelete,
    tags: externalTags,
    loadingTags: externalLoadingTags,
    fields,
    onFieldsChange,
    disableDefaults = false, // set true for trace-waterfall to hide Error/Duration
  } = props;

  const isTraces = mode === 'traces';

  const pinnedFilters = useMemo(
    () => (filters ?? []).filter((f: Filter) => f.tag === ERROR_TAG || f.tag === DURATION_TAG),
    [filters]
  );
  const userFilters = useMemo(
    () => (filters ?? []).filter((f: Filter) => f.tag !== ERROR_TAG && f.tag !== DURATION_TAG),
    [filters]
  );

  const stableFilters = useMemo(
    () =>
      (filters ?? []).filter(
        (f: Filter) => f.tag?.trim() && Array.isArray(f.value) && f.value.some((v) => v?.trim?.())
      ),
    [filters]
  );

  // Build PromQL expression for scoping available tags (metrics mode)
  const metricsTagsExpr = useMemo(() => {
    if (mode !== 'metrics' || !metricName) {
      return undefined;
    }
    // Build a PromQL expression from current filters + metric name
    const fakeQuery = {
      metricName,
      filters: stableFilters,
      groupBy: [],
    };
    const expr = promqlFromQueryBuilder(fakeQuery as any);
    return expr || undefined;
  }, [mode, metricName, stableFilters]);

  const { data: internalTags = [], loading: internalLoading } = useTags({
    datasourceId,
    startTime,
    endTime,
    enabled: mode === 'metrics' && !!metricName,
    filters: stableFilters,
    expr: metricsTagsExpr,
    mode,
    metricName,
  });

  const tags = mode !== 'metrics' ? externalTags ?? [] : internalTags;
  const loadingTags = mode !== 'metrics' ? externalLoadingTags ?? false : internalLoading;

  const updateUser = (i: number, patch: Partial<Filter>) => {
    const next = [...userFilters];
    next[i] = { ...next[i], ...patch };
    onFiltersChange([...next, ...pinnedFilters]);
  };

  const removeUser = (i: number) => {
    const next = userFilters.filter((_: any, idx: number) => idx !== i);
    onFiltersChange([...next, ...pinnedFilters]);
  };

  const addUser = () => {
    const next = [...userFilters, { tag: '', op: '=' as Operator, value: [''] }];
    onFiltersChange([...next, ...pinnedFilters]);
  };

  const upsertPinned = (tag: string, patch: Partial<Filter>) => {
    const idx = pinnedFilters.findIndex((pf: Filter) => pf.tag === tag);
    if (idx === -1) {
      const base: Filter =
        tag === ERROR_TAG
          ? { tag: ERROR_TAG, op: '=' as Operator, value: [''] }
          : { tag: DURATION_TAG, op: '>=' as Operator, value: [''] };
      onFiltersChange([...userFilters, ...pinnedFilters, { ...base, ...patch }]);
    } else {
      const nextPinned = pinnedFilters.map((pf: Filter) => (pf.tag === tag ? { ...pf, ...patch } : pf));
      onFiltersChange([...userFilters, ...nextPinned]);
    }
  };

  const removePinned = (tag: string) => {
    const nextPinned = pinnedFilters.filter((f: { tag: string }) => f.tag !== tag);
    onFiltersChange([...userFilters, ...nextPinned]);
  };

  const errorFilter = pinnedFilters.find((f: { tag: string }) => f.tag === ERROR_TAG) ?? {
    tag: ERROR_TAG,
    op: '=' as Operator,
    value: [''],
  };

  const durationFilter = pinnedFilters.find((f: { tag: string }) => f.tag === DURATION_TAG) ?? {
    tag: DURATION_TAG,
    op: '>=' as Operator,
    value: [''],
  };

  const [durUnit, setDurUnit] = useState<'ms' | 's' | 'm'>('ms');
  const durDisplay = useMemo(() => {
    const raw = String(durationFilter.value?.[0] ?? '').trim();
    const n = Number(raw);
    if (!isFinite(n) || n < 0) {
      return '';
    }
    const div = durUnit === 'ms' ? 1 : durUnit === 's' ? 1000 : 60000;
    const v = n / div;
    return String(v);
  }, [durationFilter.value, durUnit]);

  const applyDuration = (val: string, unit: 'ms' | 's' | 'm') => {
    const n = Number(val);
    if (!isFinite(n) || n < 0) {
      upsertPinned(DURATION_TAG, { value: [''] });
      return;
    }
    const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60000;
    upsertPinned(DURATION_TAG, { value: [String(ms)] });
  };

  if (isTraces) {
    const lastIndex = userFilters.length - 1;

    return (
      <>
        {userFilters.length === 0 && (
          <FilterRow
            key="blank"
            datasourceId={datasourceId}
            filter={{ tag: '', op: '=' as Operator, value: [''] }}
            index={0}
            filters={[{ tag: '', op: '=' as Operator, value: [''] }]}
            onUpdate={(_, patch) =>
              onFiltersChange([{ tag: '', op: '=' as Operator, value: [''], ...patch }, ...pinnedFilters])
            }
            onRemove={() => {}}
            onAdd={addUser}
            tags={tags}
            loadingTags={loadingTags}
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
            fields={fields}
            onFieldsChange={onFieldsChange}
            aggregation={aggregation}
            onAggregationChange={onAggregationChange}
            onAggregationDelete={onAggregationDelete}
            valueAs={valueAs}
            onValueAsChange={onValueAsChange}
            onValueAsDelete={onValueAsDelete}
            startTime={startTime}
            endTime={endTime}
            selectedFingerprint={selectedFingerprint}
            isLast={true}
            mode={mode}
          />
        )}

        {userFilters.map((f: Filter, i: number) => (
          <FilterRow
            key={`user-${i}`}
            datasourceId={datasourceId}
            filter={f}
            index={i}
            filters={userFilters}
            onUpdate={updateUser}
            onRemove={removeUser}
            onAdd={addUser}
            tags={tags}
            loadingTags={loadingTags}
            groupBy={groupBy}
            onGroupByChange={onGroupByChange}
            fields={fields}
            onFieldsChange={onFieldsChange}
            aggregation={aggregation}
            onAggregationChange={onAggregationChange}
            onAggregationDelete={onAggregationDelete}
            valueAs={valueAs}
            onValueAsChange={onValueAsChange}
            onValueAsDelete={onValueAsDelete}
            startTime={startTime}
            endTime={endTime}
            selectedFingerprint={selectedFingerprint}
            isLast={i === lastIndex}
            mode={mode}
            metricName={metricName}
            metricType={metricType}
            metricAggregation={metricAggregation}
            onMetricAggregationChange={onMetricAggregationChange}
            onMetricAggregationDelete={onMetricAggregationDelete}
            metricValueAs={metricValueAs}
            onMetricValueAsChange={onMetricValueAsChange}
            onMetricValueAsDelete={onMetricValueAsDelete}
          />
        ))}

        {!disableDefaults && (
          <InlineFieldRow style={{ marginBottom: 4, gap: 8, alignItems: 'center' }}>
            <InlineField label="Error">
              <Combobox
                width={12}
                options={[
                  { label: 'Error', value: 'Error' },
                  { label: 'Unset', value: 'Unset' },
                  { label: 'Ok', value: 'Ok' },
                ]}
                value={errorFilter.value?.[0] ?? null}
                placeholder="Select"
                onChange={(v) =>
                  v?.value
                    ? upsertPinned(ERROR_TAG, { op: '=' as Operator, value: [String(v.value)] })
                    : removePinned(ERROR_TAG)
                }
                isClearable
              />
            </InlineField>

            <InlineField label="Duration">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Combobox
                  width={10}
                  options={[
                    { label: '=', value: '=' as Operator },
                    { label: '!=', value: '!=' as Operator },
                    { label: '<', value: '<' as Operator },
                    { label: '<=', value: '<=' as Operator },
                    { label: '>', value: '>' as Operator },
                    { label: '>=', value: '>=' as Operator },
                  ]}
                  value={durationFilter.op as Operator}
                  onChange={(v) => upsertPinned(DURATION_TAG, { op: (v?.value as Operator) ?? '>=' })}
                />
                <Input
                  type="text"
                  value={durDisplay}
                  onChange={(e) => applyDuration(e.currentTarget.value, durUnit)}
                  width={20}
                  placeholder="Enter duration"
                />
                <Combobox
                  width={10}
                  options={[
                    { label: 'ms', value: 'ms' },
                    { label: 'sec', value: 's' },
                    { label: 'min', value: 'm' },
                  ]}
                  value={durUnit}
                  onChange={(v) => {
                    const u = (v?.value as 'ms' | 's' | 'm') ?? 'ms';
                    setDurUnit(u);
                    applyDuration(durDisplay, u);
                  }}
                />
                {(durationFilter.value?.[0] ?? '') !== '' && (
                  <IconButton
                    name="times"
                    onClick={() => upsertPinned(DURATION_TAG, { value: [''] })}
                    title="Clear"
                    aria-label="Clear"
                    size="sm"
                  />
                )}
              </div>
            </InlineField>

            <InlineField>
              <Button icon="plus" variant="secondary" onClick={addUser} aria-label="Add filter" />
            </InlineField>
          </InlineFieldRow>
        )}
      </>
    );
  }

  return (
    <>
      {userFilters.length === 0 && (
        <FilterRow
          key="blank"
          datasourceId={datasourceId}
          filter={{ tag: '', op: '=' as Operator, value: [''] }}
          index={0}
          filters={[{ tag: '', op: '=' as Operator, value: [''] }]}
          onUpdate={(_, patch) =>
            onFiltersChange([{ tag: '', op: '=' as Operator, value: [''], ...patch }, ...pinnedFilters])
          }
          onRemove={() => {}}
          onAdd={addUser}
          tags={tags}
          loadingTags={loadingTags}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          fields={fields}
          onFieldsChange={onFieldsChange}
          aggregation={aggregation}
          onAggregationChange={onAggregationChange}
          onAggregationDelete={onAggregationDelete}
          valueAs={valueAs}
          onValueAsChange={onValueAsChange}
          onValueAsDelete={onValueAsDelete}
          startTime={startTime}
          endTime={endTime}
          selectedFingerprint={selectedFingerprint}
          isLast={false}
          mode={mode}
        />
      )}

      {userFilters.map((f: Filter, i: number) => (
        <FilterRow
          key={`user-${i}`}
          datasourceId={datasourceId}
          filter={f}
          index={i}
          filters={userFilters}
          onUpdate={updateUser}
          onRemove={removeUser}
          onAdd={addUser}
          tags={tags}
          loadingTags={loadingTags}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          fields={fields}
          onFieldsChange={onFieldsChange}
          aggregation={aggregation}
          onAggregationChange={onAggregationChange}
          onAggregationDelete={onAggregationDelete}
          valueAs={valueAs}
          onValueAsChange={onValueAsChange}
          onValueAsDelete={onValueAsDelete}
          startTime={startTime}
          endTime={endTime}
          selectedFingerprint={selectedFingerprint}
          isLast={i === userFilters.length - 1 && pinnedFilters.length === 0}
          mode={mode}
          metricName={metricName}
          metricType={metricType}
          metricAggregation={metricAggregation}
          onMetricAggregationChange={onMetricAggregationChange}
          onMetricAggregationDelete={onMetricAggregationDelete}
          metricValueAs={metricValueAs}
          onMetricValueAsChange={onMetricValueAsChange}
          onMetricValueAsDelete={onMetricValueAsDelete}
        />
      ))}

      {pinnedFilters.map((f: Filter) => (
        <FilterRow
          key={`pinned-${f.tag}`}
          datasourceId={datasourceId}
          filter={f}
          index={-1}
          filters={pinnedFilters}
          onUpdate={(_, patch) => upsertPinned(f.tag, patch)}
          onRemove={() => removePinned(f.tag)}
          onAdd={addUser}
          tags={tags}
          loadingTags={loadingTags}
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          fields={fields}
          onFieldsChange={onFieldsChange}
          aggregation={aggregation}
          onAggregationChange={onAggregationChange}
          onAggregationDelete={onAggregationDelete}
          valueAs={valueAs}
          onValueAsChange={onValueAsChange}
          onValueAsDelete={onValueAsDelete}
          startTime={startTime}
          endTime={endTime}
          selectedFingerprint={selectedFingerprint}
          isLast={f.tag === pinnedFilters[pinnedFilters.length - 1]?.tag}
          mode={mode}
          metricName={metricName}
          metricType={metricType}
          metricAggregation={metricAggregation}
          onMetricAggregationChange={onMetricAggregationChange}
          onMetricAggregationDelete={onMetricAggregationDelete}
          metricValueAs={metricValueAs}
          onMetricValueAsChange={onMetricValueAsChange}
          onMetricValueAsDelete={onMetricValueAsDelete}
        />
      ))}
    </>
  );
}
