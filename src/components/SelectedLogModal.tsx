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
import { Modal, Button, Input, Stack, useTheme } from '@grafana/ui';
import { config } from '@grafana/runtime';

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
  fingerprint?: string;
  isOpen: boolean;
  onClose: () => void;
  filters: any[];
  extractor?: { regex: string; fields: string[] };
  timeRange: { startTime: number; endTime: number };
  datasourceId: number;
  onExtractionApply?: (
    extractor: {
      regex: string;
      logqlRegex?: string;
      fields: string[];
      selections: LogLineExtractionMatch[];
    },
    tagFilters: any[]
  ) => void;
}

function getDataTypeOfRecognizer(name: string): 'string' | 'number' {
  return ['Number', 'Digit', 'Decimal number'].includes(name) ? 'number' : 'string';
}
function generateLogQLNamedCaptureRegex(baseRegex: string, extractions: LogLineExtractionMatch[]): string {
  if (!baseRegex || !extractions.length) {
    return baseRegex;
  }

  let modifiedRegex = baseRegex;
  let captureIndex = 0;

  const capturePattern = /\((?!\?)([^)]*?)\)/g;

  modifiedRegex = modifiedRegex.replace(capturePattern, (match, innerPattern) => {
    const extraction = extractions[captureIndex];
    captureIndex++;

    if (extraction && extraction.userSelected && extraction.label && !extraction.label.startsWith('var_')) {
      const sanitizedName = extraction.label.replace(/[^a-zA-Z0-9_]/g, '_');
      return `(?P<${sanitizedName}>${innerPattern})`;
    }

    return `(?:${innerPattern})`;
  });

  return modifiedRegex;
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
  fingerprint,
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
  const [selectionFrameKey, setSelectionFrameKey] = useState(Date.now());
  const [selectionFrameQueryString, setSelectionFrameQueryString] = useState('');
  const [extractionFrameQueryString, setExtractionFrameQueryString] = useState('');

  const logQLRegex = useMemo(() => {
    if (!regex || !extractions.length) {
      return regex;
    }
    return generateLogQLNamedCaptureRegex(regex, extractions);
  }, [regex, extractions]);

  const updateSelectionFrameQueryString = (message: string, extractions: LogLineExtractionMatch[]) => {
    let queryString = `?sampleText=${encodeURIComponent(message)}`;
    const selections = extractions
      .filter((ext) => ext.userSelected === true)
      .map((ext) => `${ext.index}|${ext.recognizerName}`)
      .join(',');
    if (!!selections) {
      queryString += `&selection=${encodeURIComponent(selections)}`;
    }
    setSelectionFrameQueryString(queryString);
    setSelectionFrameKey(Date.now());
  };

  const updateExtractionFrameQueryString = (message: string, extractions: LogLineExtractionMatch[]) => {
    let queryString = `?sampleText=${encodeURIComponent(message)}`;
    const selections = extractions.map((ext) => `${ext.index}|${ext.recognizerName}`).join(',');
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
          setExtractions(seeded);
        }
      } catch {}
    }

    updateSelectionFrameQueryString(logMessage, seeded);
    updateExtractionFrameQueryString(logMessage, seeded);
  }, [logMessage, query]);

  useEffect(() => {
    function safeParseMaybeString(data: any) {
      if (typeof data !== 'string') {
        return data;
      }
      try {
        return JSON.parse(data);
      } catch (e) {
        const sanitized = data.replace(/[\u0000-\u001F]/g, '');
        try {
          return JSON.parse(sanitized);
        } catch (e2) {
          console.warn('[Extract] postMessage: failed to parse even after sanitize', e2);
          return undefined;
        }
      }
    }

    const postMessageListener = (event: MessageEvent) => {
      const isSelectionFrame = selectionFrame.current?.contentWindow === event.source;
      const isExtractionFrame = extractionFrame.current?.contentWindow === event.source;
      if (!(isSelectionFrame || isExtractionFrame)) {
        return;
      }
      if (event.data == null) {
        return;
      }

      const payload: any = safeParseMaybeString(event.data);
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const { regex, selections }: { regex?: string; selections?: string } = payload;

      setRegex(regex || '');

      if (regex) {
        setExtractions((prevExtractions) => {
          const newExtractions = (selections || '')
            .split(',')
            .map((pair: string) => {
              if (!pair) {
                return undefined;
              }
              const parts = pair.split('|');
              if (parts.length !== 2) {
                return undefined;
              }
              const index = parseInt(parts[0], 10);
              const recognizerName = parts[1];
              const prevMatch = prevExtractions.find(
                (ext) => ext.index === index && ext.recognizerName === recognizerName
              );
              const label = prevMatch?.label || '';
              const userSelected = prevMatch?.userSelected || isSelectionFrame;

              return {
                index,
                recognizerName,
                dataType: getDataTypeOfRecognizer(recognizerName),
                sampleValue: '',
                label,
                userSelected,
              } as LogLineExtractionMatch;
            })
            .filter(Boolean)
            .sort((a, b) => a!.index - b!.index) as LogLineExtractionMatch[];

          try {
            const re = new RegExp(regex, 'g');
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
      logqlRegex: logQLRegex,
      fields,
      selections,
      fp: typeof logLine === 'string' ? logLine : logLine.message,
    };
  }, [regex, extractions, logLine, logQLRegex]);

  const handleExtractClick = async () => {
    if (!queryExtractorParams) {
      return;
    }

    try {
      const tagFilters = [
        ...(fingerprint
          ? [
              {
                tag: 'chq_fingerprint',
                op: '=',
                value: [String(fingerprint)],
                dataType: 'string',
                extracted: false,
                computed: false,
              },
            ]
          : []),
      ];
      onExtractionApply?.(
        {
          regex: queryExtractorParams.regex,
          logqlRegex: queryExtractorParams.logqlRegex,
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
            key={selectionFrameKey}
            src={`${regexGenRoot}/index.html${selectionFrameQueryString}`}
            width="100%"
            style={{
              borderWidth: 0,
              width: '100%',
              margin: 12,
              marginBottom: 0,
              height: 170,
            }}
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
                    suffix={
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ border: 'none', boxShadow: 'none' }}
                        onClick={() => {
                          const updated = extractions.filter(
                            (x) => !(x.index === ext.index && x.recognizerName === ext.recognizerName)
                          );
                          setExtractions(updated);
                          updateFrameQueryStrings(logMessage, updated);
                        }}
                      >
                        Remove
                      </Button>
                    }
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
