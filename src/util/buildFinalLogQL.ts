const FINGERPRINT_KEYS = ['_cardinalhq_fingerprint', 'chq_fingerprint'] as const;

const esc = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const exprHasFpLabel = (expr: string) =>
  FINGERPRINT_KEYS.some((k) => new RegExp(`\\{[^}]*\\b${k}\\s*=\\s*`).test(expr));

const injectIntoFirstSelector = (expr: string, label: string, value: string) => {
  const m = expr.match(/\{[^}]*\}/);
  const pair = `${label}="${esc(value)}"`;
  if (m && m.index != null) {
    const start = m.index;
    const end = start + m[0].length;
    const inside = m[0].slice(1, -1).trim();
    const injected = inside.length ? `{${inside}, ${pair}}` : `{${pair}}`;
    return expr.slice(0, start) + injected + expr.slice(end);
  }
  const trimmed = expr.trim();
  return trimmed ? `{${pair}} | ${trimmed}` : `{${pair}}`;
};

export function withHiddenFingerprint(expr: string, fingerprint?: string | null): string {
  const base = (expr || '{}').trim();
  const fp = (fingerprint || '').trim();
  if (!fp || exprHasFpLabel(base)) {
    return base;
  }

  const key = 'chq_fingerprint';
  return injectIntoFirstSelector(base, key, fp);
}
