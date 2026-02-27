# Flatten Attribute Namespaces — Datasource Plugin

## Goal

Update the Grafana datasource plugin to work with LakeRunner's new flat attribute naming scheme. After LakeRunner removes namespace prefixes (`resource_`, `attr_`, `log_`, `metric_`, `span_`) from Parquet column names, the API responses will return flat names (e.g., `service_name` instead of `resource_service_name`, `level` instead of `log_level`). This plugin must be updated so that both query construction and response parsing use the new flat names.

## Background

LakeRunner's `flatten-attribute-namespaces` spec (see `lakerunner/docs/specs/flatten-attribute-namespaces.md`) removes all namespace prefixes from column names. With `features.scoped_attributes=false` (the new default):

| Old (prefixed) | New (flat) |
|---|---|
| `resource_service_name` | `service_name` |
| `attr_http_method` | `http_method` |
| `log_level` | `level` |
| `log_message` | `message` |
| `metric_name` | `name` |
| `span_trace_id` | `trace_id` |
| `span_id` | `id` |
| `span_parent_span_id` | `parent_span_id` |
| `span_name` | `name` |
| `span_kind` | `kind` |
| `span_status_code` | `status_code` |
| `span_status_message` | `status_message` |
| `span_duration` | `duration` |
| `span_start_timestamp` | `start_timestamp` |
| `span_end_timestamp` | `end_timestamp` |
| `span_events` | `events` |

Internal fields (`chq_*`, `_cardinalhq_*`) remain unchanged.

LakeRunner resolves ingest-time naming conflicts with deterministic precedence (fixed fields > resource attributes > record attributes). The datasource plugin receives already-resolved flat field names from the query API and should treat those names as canonical.

## Requirements

### Functional

1. **Response parsing**: All code that reads field/tag names from API responses must use flat names instead of prefixed names.

2. **Query construction**: All LogQL/PromQL filter expressions and label references sent to the API must use flat names.

3. **Label mapping layer**: The bidirectional mapping between user-facing names and internal names must be updated:
   - Frontend `toInternalLabel()` / `toUserLabel()` in `src/services/tags.ts`
   - Backend `mapToInternalLabel()` / `userLabelToInternal` in `pkg/plugin/datasource.go`
   - With flat naming, `message` and `level` ARE the internal names — the mapping layer becomes a no-op for these fields.

4. **Service name references**: All hardcoded references to `resource_service_name` must change to `service_name`:
   - Traces default selector
   - Service name extraction in traces
   - Log and metric component defaults

5. **Span field references**: All hardcoded `span_*` field references must use flat names:
   - `span_trace_id` → `trace_id`
   - `span_id` → `id`
   - `span_parent_span_id` → `parent_span_id`
   - `span_name` → `name`
   - `span_duration` → `duration`
   - `span_start_timestamp` → `start_timestamp`
   - `span_status_code` → `status_code`
   - `span_status_message` → `status_message`
   - `span_events` → `events`

6. **Resource tag classification**: The `isResource()` helper in traces (which checks `k.startsWith('resource_')`) must be removed or reworked — with flat naming there is no prefix to distinguish resource from record attributes.

7. **Duration handling**: References to `span_duration` as a special numeric field (in FilterRowLogQL, LogqlBuilder, FilterTags) must change to `duration`.

8. **Tag normalization**: The `displayTagName()` and `queryTagName()` functions that special-case `span_duration` / `span.duration` must be updated.

9. **Volume query defaults**: The backend default groupby for logs volume (`log_level`) must change to `level`.

10. **Internal/hidden fields**: `chq_*` and `_cardinalhq_*` field handling remains unchanged.

11. **Name-collision tolerance in UI/query builders**: The plugin must not rely on legacy prefixes to infer semantic source (resource vs record attribute). When flat names are ambiguous (for example generic keys like `name`, `id`, `kind`), behavior must be context-driven by the selected signal/query type rather than prefix heuristics.

12. **Dot/underscore normalization behavior**: Existing dotted-name to underscored-column normalization remains in place (`service.name` ↔ `service_name`). Flattening removes namespace prefixes only; it does not remove canonicalization rules.

### Non-Functional

- No backwards-compatibility shim needed — we assume flat naming is enabled and the API is already returning flat names.
- No mixed-mode support in the plugin: handling both prefixed and flat API schemas in one runtime is out of scope.
- All existing tests must be updated to reflect flat naming.
- `npm run typecheck`, `npm run lint`, and `npm run test:ci` must pass.
- Backend must compile (`mage -v`).

## Scope

### In Scope

- **Frontend services** (`src/services/`): `traces.ts`, `logql.ts`, `promql.ts`, `tags.ts` — update field name references and label mapping
- **Frontend components** (`src/components/`): `QueryEditor.tsx`, `LogQL.tsx`, `MetricsTab.tsx`, `Traces.tsx`, `FilterTags.tsx`, `FilterRowLogQL.tsx` — update hardcoded field name constants
- **Frontend utilities** (`src/util/`): `LogqlBuilder.ts`, `buildFinalLogQL.ts` — update field name references
- **Backend plugin** (`pkg/plugin/datasource.go`): update label mapping, tag normalization, volume query defaults
- **Tests**: update all test fixtures and assertions that reference prefixed names

### Out of Scope

- Feature toggle / dual-mode support — we assume flat naming is active
- Changes to API endpoints or SSE protocol
- Changes to query syntax (LogQL/PromQL grammar) — only the label names within queries change

## Acceptance Criteria

1. With LakeRunner returning flat column names, the plugin correctly:
   - Displays logs with `level` and `message` fields
   - Displays traces with `trace_id`, `name`, `duration`, `status_code` fields
   - Runs metrics queries referencing `service_name` (not `resource_service_name`)
   - Builds filter expressions using flat names

2. The `isResource()` helper is removed — trace tags are no longer classified by prefix.

3. The label mapping layer (`toInternalLabel`/`toUserLabel`) treats `message` and `level` as identity mappings (user label = internal label).

4. All tests pass with flat names: `npm run test:ci` and `mage -v`.

5. No references to `resource_`, `log_`, `span_`, `attr_` prefixed field names remain in the codebase (except in comments/docs explaining the migration).
   - Verification command: `rg -n "(resource_|log_|metric_|span_|attr_)" src pkg --glob '!**/*.md' --glob '!**/*testdata*'`

## Resolved Questions

1. `displayTagName()` / `queryTagName()` should keep generic dotted-to-underscore normalization behavior. The special-case keys must be updated from `span_duration` to `duration`.

2. `isResource()` prefix classification is removed. No replacement source-type signal is required for this migration; trace tag handling should be prefix-agnostic.
