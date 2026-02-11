---
allowed-tools: Bash, AskUserQuestion, Read
---

# Make Release

Create a new semantic version release tag.

## Instructions

1. Run `git pull --prune` to sync with remote

2. Get the latest semver tag:
   ```bash
   git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+' | head -1
   ```

3. Get commits since that tag:
   ```bash
   git log <tag>..HEAD --oneline
   ```

4. Analyze commits to suggest version bump:
   - Contains `BREAKING CHANGE` or `!:` → **major**
   - Contains `feat:` or `feat(` → **minor**
   - Otherwise → **patch**

5. Calculate the next version number

6. Use AskUserQuestion to confirm with user, showing:
   - The commits since last tag
   - Suggested bump type and new version
   - Options: suggested (Recommended), other bump types, custom version

7. Create and push the tag:
   ```bash
   git tag <version> && git push origin <version>
   ```

8. Report success with the new tag name
