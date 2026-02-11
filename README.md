# CardinalHQ LakeRunner Datasource

A Grafana datasource plugin for Cardinal HQ's LakeRunner platform, enabling visualization of logs, metrics, and traces stored in open-source private data lakes.

## Local Development

### Prerequisites

- Node.js
- Go
- Docker
- Mage (`go install github.com/magefile/mage@latest`)

### Frontend

```bash
npm install          # Install dependencies
npm run dev          # Build in watch mode
npm run build        # Production build
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix lint issues
npm run typecheck    # TypeScript type checking
npm run test         # Run Jest tests in watch mode
npm run test:ci      # Run tests once (CI mode)
```

### Backend

```bash
mage -v              # Build backend binaries for all platforms
mage -l              # List all available mage targets
```

### Running Locally

```bash
npm run server       # Start Grafana in Docker with the plugin
npm run e2e          # Run Playwright E2E tests (requires server running)
```

To test against a specific Grafana version:
```bash
GRAFANA_VERSION=11.3.0 npm run server
```

## Releasing

**Do not build or push releases locally.** The release process is fully automated via GitHub Actions.

### Creating a Release

Use the Claude Code `/make-release` skill to create releases:

```
/make-release
```

This will guide you through creating an appropriate version tag.

### How It Works

1. **Tagging triggers everything** - When you push a version tag, GitHub Actions automatically:
   - Builds the plugin for all platforms
   - Signs the plugin
   - Creates a GitHub release in this repo
   - Publishes to the public sister repo `cardinalhq-lakerunner-datasource`

2. **Tag format** - Use semantic versioning:
   - Release: `v1.2.3`
   - Release candidate: `v1.2.3-rc4`

   Both formats will be built, published, and released.

3. **No manual intervention needed** - The GitHub Action handles:
   - Multi-platform builds (Linux, Windows, Darwin)
   - Plugin signing
   - Release artifact creation
   - Publishing to both repositories

### That's It

Tag it and forget it. GitHub Actions does the rest.
