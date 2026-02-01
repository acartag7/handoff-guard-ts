---
name: release
description: Bump version, tag, push, create GitHub Release, and verify the publish workflow succeeds.
user-invocable: true
allowed-tools: Read, Edit, Bash, Grep, Glob, AskUserQuestion
---

# Release

Automates the full release process for handoff-guard (TypeScript).

## Arguments

- `version` (optional): The semver version to release, e.g. `/release 0.2.0`

## Step 1: Pre-flight checks

Run all checks in parallel where possible. Abort immediately on any failure.

1. **Typecheck:**
   ```
   Bash: pnpm run typecheck
   ```
   Abort if typecheck fails.

2. **Tests:**
   ```
   Bash: pnpm test
   ```
   Abort if tests fail.

3. **Build:**
   ```
   Bash: pnpm run build
   ```
   Abort if build fails.

4. **Clean working tree:**
   ```
   Bash: git status --porcelain
   ```
   Abort if output is non-empty (dirty tree).

5. **Read current version:**
   ```
   Read: package.json
   ```
   Extract the `version` field.

## Step 2: Determine new version

- If a version argument was provided (e.g. `/release 0.2.0`), use it.
- If no argument, ask the user:
  ```
  AskUserQuestion: "What version should this release be? Current version is {current_version}."
  ```
- Validate the version:
  - Must be valid semver (MAJOR.MINOR.PATCH)
  - Must be strictly greater than the current version
  - Abort with a clear message if validation fails

## Step 3: Bump version

1. **Edit `package.json`:**
   ```
   Edit: package.json
   old_string: "version": "{current_version}"
   new_string: "version": "{new_version}"
   ```

2. **Commit the change:**
   ```
   Bash: git add package.json && git commit -m "v{version}: <summary>"
   ```
   - If the user provided a summary, use it in the commit message.
   - Otherwise, generate a short summary from the commits since the last tag:
     ```
     Bash: git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --oneline
     ```
     Use this to write a concise summary of what changed.
   - Do NOT include `Co-Authored-By` in the commit message.

## Step 4: Tag and push

```
Bash: git tag v{version}
Bash: git push origin main && git push origin v{version}
```

## Step 5: Create GitHub Release

```
Bash: gh release create v{version} --generate-notes
```

This auto-generates release notes from commits since the previous tag.

## Step 6: Wait and verify

1. **Find the publish workflow run:**
   ```
   Bash: gh run list --workflow=publish.yml --limit=1 --json databaseId,status --jq '.[0]'
   ```

2. **Watch it:**
   ```
   Bash: gh run watch {run_id}
   ```

3. **Report result:**
   - If the run succeeds, confirm to the user: "v{version} published to npm successfully."
   - If the run fails, show the logs:
     ```
     Bash: gh run view {run_id} --log-failed
     ```
     And report the failure to the user.

## Important Notes

- Always run pre-flight checks before anything else — never skip them.
- Never amend a previous commit; always create a new one.
- The publish workflow (`publish.yml`) is triggered by the GitHub Release `published` event, so the release must be created for publishing to happen.
- Always use `pnpm` for all package operations.
