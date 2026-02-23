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


function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const RATE_WINDOW_RE = /\[(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y))+\]/g;

export function buildSeriesColorKey(name: string, labels?: Record<string, any>): string {
  const entries = Object.entries(labels ?? {});
  const hasName = labels?.['__name__'] != null;
  const nonName = entries.filter(([k]) => k !== '__name__');

  // If we have any labels at all (including __name__ alone), build a
  // stable key from metric identity + dimension tags.  This ensures
  // query-shape changes (sum→avg, rate window tweaks) never alter the key.
  if (hasName || nonName.length > 0) {
    const prefix = labels?.['__name__'] ?? '';
    const pairs = nonName
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${String(v)}`);
    return `${prefix}|${pairs.join(',')}`;
  }

  // Last resort: no labels at all — strip rate windows so time-range
  // changes don't shift colors.
  return name.replace(RATE_WINDOW_RE, '');
}

export function colorForSeries(name: string, labels?: Record<string, any>): string {
  const hash = fnv1a32(buildSeriesColorKey(name, labels));
  const hue = hash % 360;
  const saturation = 70 + ((hash >> 8) % 21); // 70..90
  const lightness = 45 + ((hash >> 16) % 16); // 45..60
  return hslToHex(hue, saturation, lightness);
}
