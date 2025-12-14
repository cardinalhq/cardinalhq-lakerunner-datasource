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
