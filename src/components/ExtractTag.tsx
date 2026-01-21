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

import { Collapse, Combobox, Icon, InlineField, InlineFieldRow, LinkButton } from '@grafana/ui';
import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { DataSource } from '../datasource';
import { MyQuery, Operator } from '../types';
import { useLogFingerprints } from '../hooks/useLogFingerprints';
import { SelectedLogModal } from './SelectedLogModal';

interface ExtractTagsComponentProps {
  datasource: DataSource;
  query: MyQuery;
  onChange: (query: MyQuery) => void;
  onRunQuery: () => void;
  timeRange: {
    startTime: number | undefined;
    endTime: number | undefined;
  };
  labelsRefreshKey: number;
  onLabelsRefresh: () => void;
  isCollapsed?: boolean;
  onCollapseToggle?: (isOpen: boolean) => void;
  showCollapseHeader?: boolean;
}

interface ExtractedData {
  chartField: string | null;
  chartAggregation: any;
  extractedNumericFields: string[];
  selectedExemplar: string | null;
  isCollapseOpen: boolean;
}

export const ExtractTagsComponent: React.FC<ExtractTagsComponentProps> = ({
  datasource,
  query,
  onChange,
  onRunQuery,
  timeRange,
  onLabelsRefresh,
  isCollapsed = false,
  onCollapseToggle,
  showCollapseHeader = true,
}) => {
  const { bodies, fingerprints } = useLogFingerprints(datasource, query.refId);
  const [selectedExemplar, setSelectedExemplar] = useState<string | null>(query.selectedExemplar ?? null);
  const [pendingFingerprint, setPendingFingerprint] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTimeRange, setModalTimeRange] = useState<{ startTime: number; endTime: number } | null>(null);
  const [isCollapseOpen, setIsCollapseOpen] = useState(isCollapsed || !!query.selectedExemplar);

  const extractedNumericFields = useMemo(() => {
    const selections = query.extractor?.selections ?? [];
    return selections
      .filter((s: any) => s.dataType === 'number' && s.label && !s.label.startsWith('var_'))
      .map((s: any) => s.label)
      .filter((v: string, i: number, self: string[]) => self.indexOf(v) === i);
  }, [query.extractor]);

  const handleCollapseToggle = () => {
    const newIsOpen = !isCollapseOpen;
    setIsCollapseOpen(newIsOpen);
    onCollapseToggle?.(newIsOpen);
  };

  const exemplarOptions = React.useMemo(
    () =>
      bodies.map((b, i) => {
        const fp = fingerprints[i];
        const id = fp ? `fp:${fp}` : `body:${b}`;
        return { label: b, value: id };
      }),
    [bodies, fingerprints]
  );

  const selectedId = pendingFingerprint
    ? `fp:${pendingFingerprint}`
    : selectedExemplar
    ? `body:${selectedExemplar}`
    : undefined;

  const hasExtraction = !!query.extractor || !!selectedExemplar || extractedNumericFields.length > 0;

  const resetExtraction = () => {
    const scrubbedFilters = (query.filters ?? []).filter((f) => f.tag !== 'chq_fingerprint');

    setSelectedExemplar(null);
    setPendingFingerprint(null);
    setIsCollapseOpen(false);

    const next: MyQuery = {
      ...query,
      extractor: undefined,
      filters: scrubbedFilters.length ? scrubbedFilters : [{ tag: '', op: '=' as Operator, value: [''] }],
      groupBy: [],
      selectedExemplar: undefined,
      selectedFingerprint: undefined,
    };

    if (typeof next.valueAs === 'string' && next.valueAs.startsWith('field_values:')) {
      (next as any).valueAs = undefined;
    }

    onChange(next);
    onLabelsRefresh();
  };

  const handleExemplarChange = (opt: any) => {
    if (!opt?.value) {
      setSelectedExemplar(null);
      setPendingFingerprint(null);
      return;
    }
    const val = String(opt.value);
    if (val.startsWith('fp:')) {
      const fp = val.slice(3);
      const match = bodies[fingerprints.indexOf(fp)];
      setSelectedExemplar(match ?? '');
      setPendingFingerprint(fp);
    } else if (val.startsWith('body:')) {
      const body = val.slice(5);
      setSelectedExemplar(body);
      setPendingFingerprint(null);
    }
  };
  const collapseContent = (
    <>
      <InlineFieldRow>
        <InlineField label="Select Message">
          <Combobox
            placeholder="Select a message"
            options={exemplarOptions}
            value={selectedId ?? null}
            isClearable
            width={80}
            onChange={handleExemplarChange}
          />
        </InlineField>
        <InlineField>
          <LinkButton
            variant="secondary"
            onClick={() => {
              setModalTimeRange({
                startTime: timeRange.startTime ?? Date.now() - 5 * 60 * 1000,
                endTime: timeRange.endTime ?? Date.now(),
              });
              setIsModalOpen(true);
            }}
            style={{ marginLeft: 8 }}
          >
            Extract tags
          </LinkButton>
        </InlineField>
        <InlineField>
          <LinkButton variant="secondary" onClick={resetExtraction} disabled={!hasExtraction} style={{ marginLeft: 8 }}>
            Reset
          </LinkButton>
        </InlineField>
      </InlineFieldRow>

      <SelectedLogModal
        logLine={selectedExemplar ?? ''}
        isOpen={isModalOpen}
        fingerprint={pendingFingerprint ?? ''}
        onClose={() => setIsModalOpen(false)}
        filters={query.filters || []}
        timeRange={{
          startTime: modalTimeRange?.startTime ?? 0,
          endTime: modalTimeRange?.endTime ?? 0,
        }}
        datasourceId={datasource.id}
      />
    </>
  );

  if (!showCollapseHeader) {
    return <div>{collapseContent}</div>;
  }

  return (
    <Collapse
      label={
        <div className={css({ display: 'flex', alignItems: 'center', gap: 8 })}>
          <Icon name={isCollapseOpen ? 'angle-down' : 'angle-right'} />
          <span>Extract tags from message</span>
        </div>
      }
      isOpen={isCollapseOpen}
      onToggle={handleCollapseToggle}
    >
      {collapseContent}
    </Collapse>
  );
};

export const useExtractedData = (query: MyQuery): ExtractedData => {
  const extractedNumericFields = useMemo(() => {
    const selections = query.extractor?.selections ?? [];
    return selections
      .filter((s: any) => s.dataType === 'number' && s.label && !s.label.startsWith('var_'))
      .map((s: any) => s.label)
      .filter((v: string, i: number, self: string[]) => self.indexOf(v) === i);
  }, [query.extractor]);

  return {
    chartField: null,
    chartAggregation: 'sum',
    extractedNumericFields,
    selectedExemplar: query.selectedExemplar ?? null,
    isCollapseOpen: !!query.selectedExemplar,
  };
};

export default ExtractTagsComponent;
