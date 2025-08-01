import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Input, Stack, useTheme } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { buildNestedFilter } from '../util/buildNestedFilter';

interface LogLineExtractionMatch {
  index: number;
  sampleValue: string;
  label: string;
  userSelected: boolean;
  recognizerName: string;
  dataType: 'string' | 'number';
}

interface SelectedLogModalProps {
  logLine: any;
  isOpen: boolean;
  onClose: () => void;
  filters: any[];
  extractor?: { regex: string; fields: string[] };
  timeRange: { startTime: number; endTime: number };
  datasourceId: number;
  onExtractionApply?: (
    extractor: {
      regex: string;
      fields: string[];
      selections: LogLineExtractionMatch[];
    },
    tagFilters: any[]
  ) => void;
}

function getDataTypeOfRecognizer(name: string): 'string' | 'number' {
  return ['Number', 'Digit', 'Decimal number'].includes(name) ? 'number' : 'string';
}

export const SelectedLogModal: React.FC<SelectedLogModalProps> = ({
  logLine,
  isOpen,
  onClose,
  filters,
  timeRange,
  extractor,
  datasourceId,
  onExtractionApply,
}) => {
  const theme = useTheme();
  const pluginId = 'cardinalhq-lakerunner-datasource';
  const regexGenRoot = `${config.appSubUrl || ''}/public/plugins/${pluginId}/static/regexgen`;

  const selectionFrame = useRef<HTMLIFrameElement>(null);
  const extractionFrame = useRef<HTMLIFrameElement>(null);

  const [regex, setRegex] = useState('');
  const [extractions, setExtractions] = useState<LogLineExtractionMatch[]>([]);

  const logMessage: string = useMemo(
    () => (typeof logLine === 'string' ? logLine ?? '' : logLine?.message ?? ''),
    [logLine]
  );

  const query = useMemo(() => (extractor ? { params: { stages: { extractor } } } : undefined), [extractor]);

  const selectedExtractions = useMemo(() => extractions.filter((e) => e.userSelected), [extractions]);

  const [selectionFrameQueryString, setSelectionFrameQueryString] = useState('');
  const [extractionFrameQueryString, setExtractionFrameQueryString] = useState('');

  const updateSelectionFrameQueryString = (message: string, extList: LogLineExtractionMatch[]) => {
    let queryString = `?sampleText=${encodeURIComponent(message)}`;
    const selections = extList
      .filter((ext) => ext.userSelected === true)
      .map((ext) => `${ext.index}|${ext.recognizerName}`)
      .join(',');
    if (!!selections) {
      queryString += `&selection=${encodeURIComponent(selections)}`;
    }
    setSelectionFrameQueryString(queryString);
  };

  const updateExtractionFrameQueryString = (message: string, extList: LogLineExtractionMatch[]) => {
    let queryString = `?sampleText=${encodeURIComponent(message)}`;
    const selections = extList.map((ext) => `${ext.index}|${ext.recognizerName}`).join(',');
    if (!!selections) {
      queryString += `&selection=${encodeURIComponent(selections)}&extractPlaceholders=true`;
    }
    setExtractionFrameQueryString(queryString);
  };

  const updateFrameQueryStrings = (message: string, extList: LogLineExtractionMatch[]) => {
    updateSelectionFrameQueryString(message, extList);
    updateExtractionFrameQueryString(message, extList);
  };

  useEffect(() => {
    const seeded: LogLineExtractionMatch[] = [];
    const ex = query?.params?.stages?.extractor;
    if (ex && ex.regex && logMessage) {
      try {
        const re = new RegExp(ex.regex, 'g');
        const matches = Array.from(logMessage.matchAll(re));
        const selections = (ex as any).selections || [];

        if (matches.length === 1 && matches[0].length - 1 === selections.length) {
          let line = matches[0][0];
          let offset = 0;
          matches[0].slice(1).forEach((m, idx) => {
            const sel = selections[idx];
            const position = line.indexOf(m);

            seeded.push({
              index: position + offset,
              recognizerName: sel.recognizerName,
              dataType: sel.dataType,
              label: sel.label,
              userSelected: sel.userSelected,
              sampleValue: m,
            });

            line = line.substring(position + m.length);
            offset += position + m.length;
          });
          setRegex(ex.regex || '');
          setExtractions(seeded);
        }
      } catch {}
    }

    updateSelectionFrameQueryString(logMessage, seeded);
    updateExtractionFrameQueryString(logMessage, seeded);
  }, [logMessage, query]);

  useEffect(() => {
    const postMessageListener = (event: MessageEvent) => {
      const isSelectionFrame = selectionFrame.current?.contentWindow === event.source;
      const isExtractionFrame = extractionFrame.current?.contentWindow === event.source;

      if ((isSelectionFrame || isExtractionFrame) && !!event.data) {
        let payload: any = event.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            return;
          }
        }
        const { regex: rx, selections }: { regex: string; selections: string } = payload;
        setRegex(rx || '');

        if (rx) {
          setExtractions((prevExtractions) => {
            const newExtractions = (selections || '')
              .split(',')
              .map((pair: string) => {
                if (!pair) {
                  return undefined;
                }
                const parts = pair.split('|');
                if (parts.length === 2) {
                  const index = parseInt(parts[0], 10);
                  const recognizerName = parts[1];
                  const prevMatch = prevExtractions.find(
                    (ext) => ext.index === index && ext.recognizerName === recognizerName
                  );
                  const label = prevMatch?.label || '';
                  const userSelected = prevMatch?.userSelected ?? isSelectionFrame;

                  return {
                    index,
                    recognizerName,
                    dataType: getDataTypeOfRecognizer(recognizerName),
                    sampleValue: '',
                    label,
                    userSelected,
                  } as LogLineExtractionMatch;
                }
                return undefined;
              })
              .filter(Boolean)
              .sort((a, b) => a!.index - b!.index) as LogLineExtractionMatch[];

            try {
              const re = new RegExp(rx, 'g');
              const matches = Array.from(logMessage.matchAll(re));
              if (matches.length === 1 && matches[0].length > 1) {
                const samples = matches[0].slice(1);
                if (samples.length === newExtractions.length) {
                  newExtractions.forEach((ext, i) => {
                    ext.sampleValue = samples[i];
                  });
                }
              }
            } catch {}

            if (isSelectionFrame) {
              updateExtractionFrameQueryString(logMessage, newExtractions);
            }

            return newExtractions;
          });
        }
      }
    };

    window.addEventListener('message', postMessageListener);
    return () => window.removeEventListener('message', postMessageListener);
  }, [logMessage]);

  const queryExtractorParams = useMemo(() => {
    if (!regex || !extractions.length || !logLine) {
      return undefined;
    }

    const fields: string[] = [];
    const selections: LogLineExtractionMatch[] = [];

    extractions.forEach((ext, index) => {
      const label = ext.userSelected ? ext.label : `var_${index}`;
      fields.push(label);
      selections.push({
        index: ext.index,
        recognizerName: ext.recognizerName,
        dataType: ext.dataType,
        label,
        userSelected: ext.userSelected,
        sampleValue: '',
      });
    });

    return {
      regex,
      fields,
      selections,
      fp: typeof logLine === 'string' ? logLine : logLine.message,
    };
  }, [logLine, regex, extractions]);

  const handleExtractClick = async () => {
    if (!queryExtractorParams) {
      return;
    }

    const baseFilter = buildNestedFilter(filters);
    const queryFilter = {
      op: 'and',
      q1: baseFilter,
      ...Object.fromEntries(
        queryExtractorParams.selections
          .filter((s) => s.userSelected)
          .map((ext, i) => [
            `q${i + 2}`,
            {
              k: ext.label || `var_${i}`,
              v: [''],
              op: 'has',
              dataType: ext.dataType,
              extracted: true,
              computed: false,
            },
          ])
      ),
    };

    const payload = {
      baseExpressions: {
        a: {
          dataset: 'logs',
          limit: 1000,
          order: 'DESC',
          returnResults: true,
          filter: queryFilter,
          extract: {
            regex: queryExtractorParams.regex,
            fields: queryExtractorParams.fields.map((name, i) => ({
              name,
              type: queryExtractorParams.selections[i].dataType,
            })),
          },
        },
      },
    };

    const params = new URLSearchParams({
      s: `${timeRange.startTime}`,
      e: `${timeRange.endTime}`,
    });

    try {
      await fetch(`/api/datasources/${datasourceId}/resources/proxy-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `/api/v1/graph?${params.toString()}`, body: payload }),
      });

      const tagFilters = queryExtractorParams.selections
        .filter((s) => s.userSelected)
        .map(({ label, dataType }, i) => ({
          tag: label || `var_${i}`,
          op: 'has',
          value: [''],
          dataType,
          extracted: true,
          computed: false,
        }));

      onExtractionApply?.(
        {
          regex: queryExtractorParams.regex,
          fields: queryExtractorParams.fields,
          selections: queryExtractorParams.selections,
        },
        tagFilters
      );

      onClose();
    } catch (err) {
      console.error('[handleExtractClick]', err);
    }
  };

  return (
    <Modal title="Extract Tags from Log Message" isOpen={isOpen} onDismiss={onClose}>
      <div style={{ maxWidth: '100%', overflowY: 'auto' }}>
        <div style={{ marginBottom: theme.spacing.md }}>
          <div style={{ marginBottom: theme.spacing.sm }}>1. Select variable parts from the log message</div>
          <iframe
            ref={selectionFrame}
            src={`${regexGenRoot}/index.html${selectionFrameQueryString}`}
            style={{ width: '100%', height: 165, border: 0 }}
          />
        </div>

        {selectedExtractions.length > 0 && (
          <div style={{ marginBottom: theme.spacing.md }}>
            <div style={{ marginBottom: theme.spacing.sm }}>2. Assign tag names</div>
            <Stack direction="row" wrap gap={4}>
              {selectedExtractions.map((ext, idx) => (
                <div
                  key={`${ext.index}-${ext.recognizerName}-${idx}`}
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <span
                    style={{ fontFamily: 'Roboto Mono', fontSize: 10, opacity: 0.6, marginRight: theme.spacing.sm }}
                  >
                    {ext.sampleValue}
                  </span>
                  <Input
                    value={ext.label.startsWith('var_') ? '' : ext.label}
                    placeholder="tag name"
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      setExtractions((prev) =>
                        prev.map((x) =>
                          x.index === ext.index && x.recognizerName === ext.recognizerName ? { ...x, label: v } : x
                        )
                      );
                    }}
                    style={{
                      width: `${Math.max((ext.label ? ext.label.length : 0) || 10, 10)}ch`,
                      fontFamily: 'Roboto Mono',
                      fontSize: 12,
                      marginRight: theme.spacing.sm,
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const updated = extractions.filter(
                        (x) => !(x.index === ext.index && x.recognizerName === ext.recognizerName)
                      );
                      setExtractions(updated);
                      updateFrameQueryStrings(logMessage, updated);
                    }}
                    style={{ borderWidth: 0 }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </Stack>
          </div>
        )}

        <iframe
          ref={extractionFrame}
          src={`${regexGenRoot}/index.html${extractionFrameQueryString}`}
          style={{ display: 'none', width: '100%', height: 1, border: 0 }}
        />

        <div style={{ textAlign: 'right', marginTop: theme.spacing.lg }}>
          <Button variant="primary" disabled={!selectedExtractions.length || !regex} onClick={handleExtractClick}>
            Extract Tags
          </Button>
          <Button variant="secondary" onClick={onClose} style={{ marginLeft: theme.spacing.sm }}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
