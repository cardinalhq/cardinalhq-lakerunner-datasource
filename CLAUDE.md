# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Grafana datasource plugin for Cardinal HQ's LakeRunner platform. It enables visualization of logs, metrics, and traces stored in open-source private data lakes. The plugin has both frontend (TypeScript/React) and backend (Go) components.

## Common Commands

### Frontend Development
```bash
npm install          # Install dependencies
npm run dev          # Build in watch mode
npm run build        # Production build
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix lint issues and format with Prettier
npm run typecheck    # TypeScript type checking
npm run test         # Run Jest tests in watch mode
npm run test:ci      # Run tests once (CI mode)
```

### Backend Development
```bash
mage -v              # Build backend binaries for all platforms (Linux, Windows, Darwin)
mage -l              # List all available mage targets
```

### Running Locally
```bash
npm run server       # Start Grafana in Docker with the plugin
npm run e2e          # Run Playwright E2E tests (requires server running)
```

## Architecture

### Frontend (src/)
- **module.ts**: Plugin entry point, registers DataSource and editors
- **datasource.ts**: Main `DataSource` class implementing Grafana's data source API
  - Handles three query modes: logs, metrics, traces
  - Implements supplementary queries (LogsVolume, LogsSample)
  - Manages fingerprint/log body storage for log correlation
  - Supports Grafana template variables via `metricFindQuery()`
- **PluginRoot.tsx**: Wraps QueryEditor with React Query's QueryClientProvider
- **types.ts**: TypeScript interfaces for queries, filters, operators, and data source options

### Query Execution Flow
1. `DataSource.query()` processes requests with template variable substitution
2. Based on `query.mode`, delegates to service functions:
   - `services/promql.ts` → `/api/v1/metrics/query` (SSE streaming)
   - `services/logql.ts` → `/api/v1/logs/query` (SSE streaming)
   - `services/traces.ts` → Traces endpoint
3. Services stream results via SSE, progressively emitting DataFrames

### Backend (pkg/)
- **main.go**: Plugin entry point using Grafana plugin SDK
- **plugin/datasource.go**: Implements QueryDataHandler, CheckHealthHandler, and resource proxy
  - Handles timeseries queries with SSE response parsing
  - `proxy-promql` resource handler proxies requests to CardinalHQ API
- **models/settings.go**: Plugin settings including API key and custom path

### UI Components (src/components/)
- **QueryEditor.tsx**: Tab-based editor switching between Logs, Metrics, Traces modes
- **LogQL.tsx**, **MetricsTab.tsx**, **Traces.tsx**: Mode-specific query builders
- **FilterTags.tsx**, **FilterRowLogQL.tsx**: Filter UI components

### Query Building Utilities (src/util/)
- **LogqlBuilder.ts**: Generates LogQL expressions from UI builder state
- **MetricsBuilder.ts**: Generates PromQL-like expressions
- **buildFinalLogQL.ts**: Applies fingerprint filtering to LogQL

### Hooks (src/hooks/)
React Query hooks for fetching metadata:
- `useMetricNames`, `useTagKeys`, `useTagValues`, `useLogFingerprints`

## Key Patterns

### Filter Structure
Filters use operators: `=`, `!=`, `in`, `not_in`, `contains`, `not contains`, `regex`, `not regex`, `has`, `>`, `<`, `>=`, `<=`

### SSE Streaming
Both frontend services and backend handle Server-Sent Events with progressive frame emission for responsive UI updates.

### Template Variables
Supports `tag_keys()`, `tag_values(label)`, and `label_values(expr, label)` syntax with `dataset=logs|metrics|traces` parameter.
