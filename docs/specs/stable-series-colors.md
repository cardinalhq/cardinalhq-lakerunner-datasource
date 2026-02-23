# Stable Series Colors & Brightened Palette

## Status
Accepted

## Problem

`colorForSeries(name, labels)` builds its hash key from `name` (the raw SSE label string) plus sorted label key-value pairs. In metrics mode, `name` is a string like `sum by (svc)(rate(http_total[20s]))`. When the user changes the rate window, aggregation function, or time range, this label string changes and the series color shifts even though the underlying dimensions (`{svc="foo"}`) haven't changed. Users see colors shuffling on every interaction that shouldn't affect series identity.

Additionally, the HSL palette (saturation 60–79%, lightness 38–51%) produces muted colors that are hard to distinguish on dark Grafana themes.

## Goal

1. Series colors are stable across query-shape changes (aggregation, rate window, time range) when the underlying metric identity and dimensions are unchanged.
2. Colors are more vivid and distinguishable, especially on dark themes.

## Scope

- `src/util/seriesColor.ts` — color key derivation and HSL palette
- `src/util/seriesColor.test.ts` — unit tests

The log volume call site in `src/services/logql.ts` already passes structured `labels` to `colorForSeries`, so the fix in `seriesColor.ts` covers it without call-site changes.

## Non-Goals

- Changing how `labels`/`tags` are propagated from SSE responses
- Guaranteeing color uniqueness (hash collisions are acceptable)
- Persisting color assignments across sessions

## Color Key Derivation

`buildSeriesColorKey(name, labels)` produces a stable hash input:

### When labels contain any entries (including `__name__` alone)

```
prefix = labels['__name__'] ?? ''
pairs  = sorted k=v from labels, excluding __name__
key    = `${prefix}|${pairs.join(',')}`
```

Examples:
| labels | key |
|--------|-----|
| `{__name__: "http_total", svc: "foo", region: "us"}` | `http_total\|region=us,svc=foo` |
| `{__name__: "http_total"}` | `http_total\|` |
| `{env: "prod", region: "us"}` | `\|env=prod,region=us` |

The `name` parameter is ignored entirely when labels are present, because it contains volatile query-shape information (aggregation function, rate window).

### Fallback: no labels

When `labels` is undefined or an empty object, the function falls back to `name` with PromQL range-vector windows stripped:

```
name.replace(/\[(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w|y))+\]/g, '')
```

Examples:
| name | key |
|------|-----|
| `rate(http_total[20s])` | `rate(http_total)` |
| `rate(x[1h30m])` | `rate(x)` |
| `my-plain-series` | `my-plain-series` |

## Stability Guarantees

| Change | Color changes? | Reason |
|--------|---------------|--------|
| Rate window (`[20s]` → `[2h]`) | No | Window not in key (labels path ignores name; fallback strips windows) |
| Aggregation (`sum` → `avg`) | No | Aggregation not in key (labels path ignores name) |
| Dimension value change (`svc=foo` → `svc=bar`) | Yes | Dimension is part of key |
| Group-by change (adds/removes dimension) | Yes | Dimensions are part of key |
| Different metric name, same dimensions | Yes | `__name__` prefix differs |

## HSL Palette

| Parameter | Previous | Current |
|-----------|----------|---------|
| Saturation | 60–79% | 70–90% |
| Lightness | 38–51% | 45–60% |

Hue is derived from hash modulo 360 (unchanged).

## Test Requirements

1. Key format: `__name__` prefix with dimension pairs, `__name__` excluded from pairs
2. Key stability: `__name__`-only labels produce stable key independent of name
3. Fallback: rate windows stripped, plain names unchanged
4. Color stability: same color across rate window changes, aggregation changes, and `__name__`-only aggregation changes
5. Color differentiation: different colors for different dimensions, different metric names
6. Valid output: all colors match `#[0-9a-f]{6}`

## Acceptance Criteria

- Changing time range or aggregation function does not shift series colors when dimensions are unchanged
- Colors are visibly more vivid than the previous palette
- All existing call sites (`promql.ts`, `logql.ts`) benefit without code changes
- 19 unit tests pass covering key derivation, stability, and differentiation
