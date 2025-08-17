import React, { useMemo } from 'react';
import Editor from 'react-simple-code-editor';
import PrismCore from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/themes/prism-tomorrow.css';
let promqlRegistered = false;

function registerPromQL() {
  if (promqlRegistered) {
    return;
  }
  promqlRegistered = true;

  PrismCore.languages.promql = {
    comment: /#.*/m,
    string: /"(?:\\.|[^"\\])*"/,
    number: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    duration: /\b\d+(?:ms|s|m|h|d|w|y)\b/,
    function: {
      pattern:
        /\b(abs|absent|avg|avg_over_time|bottomk|ceil|changes|clamp_max|clamp_min|count|count_over_time|delta|deriv|exp|floor|histogram_quantile|holt_winters|idelta|increase|irate|label_join|label_replace|last_over_time|ln|log2|log10|max|max_over_time|min|min_over_time|predict_linear|quantile|rate|round|sgn|sort|sort_desc|sqrt|stddev|stddev_over_time|stdvar|stdvar_over_time|sum|sum_over_time|topk)\b/,
      greedy: true,
    },
    keyword: /\b(by|without|on|ignoring|group_left|group_right|bool|offset|and|or|unless)\b/,
    operator: /=~|!~|==|!=|>=|<=|=|>|<|\+|-|\*|\/|%|\^/,
    label: {
      pattern: /[a-zA-Z_][a-zA-Z0-9_.]*(?=\s*(?:=~|!~|==|!=|=))/,
      alias: 'attr-name',
    },
    metric: {
      pattern: /[a-zA-Z_:][a-zA-Z0-9_:.]*(?=\s*\{)/,
      alias: 'class-name',
    },
    identifier: /[a-zA-Z_:][a-zA-Z0-9_:.]*/,
    punctuation: /[{}()[\];,]/,
  };
}

type PrismPromQLEditorProps = {
  value: string;
  language?: string;
  height?: number;
  width?: number | string;
  wordWrap?: boolean;
  showLineNumbers?: boolean;
  showMiniMap?: boolean;
  onBeforeEditorMount?: (prism: typeof PrismCore) => void;
  onChange?: (val: string) => void;
  onBlur?: () => void;
};

export function PrismPromQLEditor({
  value,
  language = 'promql',
  height = 120,
  width = '100%',
  wordWrap = true,
  onBeforeEditorMount,
  onChange,
  onBlur,
}: PrismPromQLEditorProps) {
  useMemo(() => {
    registerPromQL();
    onBeforeEditorMount?.(PrismCore);
  }, [onBeforeEditorMount]);

  const highlight = (code: string) => {
    const lang = PrismCore.languages[language] || PrismCore.languages.promql || PrismCore.languages.clike;
    return PrismCore.highlight(code, lang, language);
  };

  return (
    <div style={{ width }}>
      <Editor
        value={value}
        onValueChange={(v) => onChange?.(v)}
        onBlur={onBlur}
        highlight={highlight}
        padding={8}
        style={{
          fontFamily:
            'var(--font-family-monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
          fontSize: 12,
          minHeight: height,
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          outline: 'none',
          background: 'var(--input-bg, rgba(0,0,0,0.2))',
          border: '1px solid var(--border-weak, rgba(255,255,255,0.12))',
          borderRadius: 4,
        }}
      />
    </div>
  );
}
