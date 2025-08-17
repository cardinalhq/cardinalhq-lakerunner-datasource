import React from 'react';
import { Button, InlineField, InlineFieldRow } from '@grafana/ui';
import { getBackendSrv } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { PrismPromQLEditor } from './PrismEditor';

type Props = {
  datasourceId: number;
  description: string;
  output: string;
  onChange: (patch: { description?: string; output?: string }) => void;
};

export default function PromqlSynthesizer({ datasourceId, description, output, onChange }: Props) {
  const [loading, setLoading] = React.useState(false);
  const PROXY_URL = `/api/datasources/${datasourceId}/resources/proxy-promql`;

  async function synthesize() {
    if (!description?.trim()) {
      return;
    }
    setLoading(true);
    try {
      const res = await firstValueFrom(
        getBackendSrv().fetch<{ promql?: string }>({
          url: PROXY_URL,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: { path: '/promql', body: { description } },
        })
      );
      const data = (res as any).data ?? (res as any);
      onChange({ output: data?.promql ?? '' });
    } catch (e) {
      console.error('PROMQL synth failed', e);
      onChange({ output: '' });
    } finally {
      setLoading(false);
    }
  }

  const runIfShortcut = async (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      await synthesize();
    }
  };

  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 12 })}>
      <InlineFieldRow>
        <InlineField label="Description">
          <textarea
            value={description}
            onChange={(e) => onChange({ description: e.target.value })}
            onKeyDown={runIfShortcut}
            className={css({
              width: '500px',
              height: 50,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 12,
              padding: 8,
              borderRadius: 4,
              border: '1px solid var(--border-weak, #303030)',
              background: 'var(--panel-bg, #1f1f1f)',
              color: 'var(--text, #e8e8e8)',
            })}
            placeholder="Describe the PromQL expression..."
          />
        </InlineField>

        <Button
          variant="secondary"
          style={{ height: 'fit-content', backgroundColor: '#303030', color: '#fff', border: 'none' }}
          onClick={synthesize}
          disabled={loading || !description?.trim()}
        >
          {loading ? 'Working…' : 'Run'}
        </Button>
      </InlineFieldRow>

      <InlineField label="Output" grow>
        <div className={css({ width: '100%' })}>
          <PrismPromQLEditor
            value={output || ''}
            language="promql"
            height={35}
            width="100%"
            wordWrap
            onChange={(val) => onChange({ output: val })}
          />
        </div>
      </InlineField>
    </div>
  );
}
