---
name: make-release
description: This skill should be used when the user asks to "make a release", "create a release", "tag a release", "bump the version", "push a new version", or invokes "/make-release". Automates git tagging and release workflow with semantic versioning.
---

# Make Release

Automate the release process by determining the next semantic version from git history and creating/pushing a tag.

## Workflow

1. **Sync with remote**: Pull latest changes and prune deleted branches
2. **Get current version**: Find the latest semver tag (e.g., `v1.9.10`)
3. **Analyze commits**: Review commits since last tag to determine version bump
4. **Confirm with user**: Present the suggested bump and allow override
5. **Update package.json**: Bump version using npm version
6. **Commit and push**: Commit package.json changes and push
7. **Create and push tag**: Tag the current commit and push to origin

## Version Bump Rules

Analyze commit messages since the last tag to suggest a version bump:

| Commit Pattern | Bump Type | Example |
|----------------|-----------|---------|
| `BREAKING CHANGE:` or `!:` in message | **major** | `feat!: remove deprecated API` |
| `feat:` or `feat(scope):` | **minor** | `feat: add dark mode` |
| `fix:`, `docs:`, `chore:`, `refactor:`, etc. | **patch** | `fix: resolve null pointer` |

If no conventional commits found, default to **patch**.

## Execution Steps

### Step 1: Sync Repository

```bash
git pull --prune
```

### Step 2: Get Latest Tag

```bash
git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -1
```

### Step 3: Analyze Commits

Get commits since last tag:

```bash
git log <last-tag>..HEAD --oneline
```

Scan for:
- `BREAKING CHANGE` or `!:` → major
- `feat:` or `feat(` → minor
- Everything else → patch

### Step 4: Calculate Next Version

Parse current version and increment appropriately:
- **major**: `v1.9.10` → `v2.0.0`
- **minor**: `v1.9.10` → `v1.10.0`
- **patch**: `v1.9.10` → `v1.9.11`

### Step 5: Confirm with User

Use AskUserQuestion to confirm the suggested version:

```
Suggested version bump: patch (v1.9.10 → v1.9.11)

Based on commits:
- fix: resolve legend display issue
- chore: cleanup unused code

Options: [patch (Recommended)] [minor] [major] [custom]
```

### Step 6: Update package.json

Update the version in package.json (without 'v' prefix):

```bash
npm version <version-without-v> --no-git-tag-version
```

### Step 7: Commit and Push

```bash
git add package.json package-lock.json
git commit -m "<new-version>"
git push
```

### Step 8: Create and Push Tag

```bash
git tag <new-version>
git push origin <new-version>
```

## Edge Cases

- **No previous tags**: Start at `v0.1.0` and ask user to confirm
- **Dirty working tree**: Warn user and ask if they want to proceed
- **No commits since last tag**: Warn and ask if they still want to tag

## Example Usage

User: `/make-release`

Response:
```
Syncing with remote...
Latest tag: v1.9.10

Commits since v1.9.10:
- 69a2116 Fix logs legend showing detected_level instead of group by keys

Suggested: patch bump → v1.9.11

[Confirm version with user]

Updated package.json to 1.9.11
Committed and pushed package.json
Created and pushed tag v1.9.11
```
