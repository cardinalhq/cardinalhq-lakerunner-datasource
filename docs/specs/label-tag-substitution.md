# Label/Tag Substitution for Metrics legendFormat

## Problem

The CardinalHQ metrics API returns structured `tags` alongside every SSE data point:

```json
{
  "type": "result",
  "data": {
    "timestamp": 1700000000000,
    "value": 42.5,
    "label": "resource_service_name=frontend, __name__=http_server_request_duration",
    "tags": {
      "resource_service_name": "frontend",
      "__name__": "http_server_request_duration"
    }
  }
}
```

Both the frontend streaming service (`promql.ts`) and the backend alerting path (`datasource.go`) discard the `tags` field. Setting `legendFormat: "{{resource_service_name}}"` on a panel has no effect — legends show the raw `label` string.

## Behavior

- When `legendFormat` is set and non-empty, replace `{{tagName}}` placeholders with values from the series `tags` map.
- When `legendFormat` is empty/unset, fall back to the raw `label` string from the API (existing behavior).
- Structured `tags` are always set as Grafana field `labels` regardless of `legendFormat`. This enables Grafana's built-in label display, filtering, and ad-hoc filters.

## Scope

Applies to **metrics mode queries only**, in both:
- Frontend streaming path (`src/services/promql.ts`)
- Backend alerting path (`pkg/plugin/datasource.go`)

## SSE Contract

Metrics `result` SSE events have the following shape:

```
data: {"type":"result","data":{"timestamp":<int64_ms>,"value":<number>,"label":<string>,"tags":<object|null>}}
```

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | int64 | Unix milliseconds |
| `value` | number (or `{num: number}`) | Metric value |
| `label` | string | Raw series label |
| `tags` | `Record<string, any>` or null | Structured tag key/value pairs |

## Template Syntax

`{{key}}` — matches Prometheus/Grafana convention.

Example: `legendFormat: "{{resource_service_name}} - {{__name__}}"` with tags `{"resource_service_name": "frontend", "__name__": "http_server_request_duration"}` produces `"frontend - http_server_request_duration"`.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Missing tag key | Placeholder left as literal text (e.g. `{{missing}}` remains `{{missing}}`) |
| Empty legendFormat | Use raw `label` string |
| Null/undefined tags | Use raw `label` string |
| legendFormat with no placeholders | Use the literal legendFormat string as display name |

## Field Labels

Structured tags from the SSE response are always set as Grafana field `labels` on the Value field, independent of `legendFormat`. This follows the existing pattern in `logql.ts`.

## Test Matrix

1. **legendFormat with matching tags** → display name has substituted values
2. **legendFormat with missing tag key** → unresolved `{{key}}` left as-is
3. **Empty legendFormat** → falls back to raw label
4. **Missing legendFormat field** → falls back to raw label
5. **Null/undefined tags on SSE data** → falls back to raw label
6. **Tags always set as field labels** → regardless of legendFormat
7. **Backend applies legendFormat** → `DisplayNameFromDS` uses substituted value
8. **Backend sets field labels** → value field carries tags as labels
