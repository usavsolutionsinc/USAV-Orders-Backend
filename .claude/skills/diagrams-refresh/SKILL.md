---
name: diagrams-refresh
description: Regenerate the project's dependency-cruiser architecture diagrams and update docs/architecture/manifest.json. Use when src/ structure has shifted enough that the diagrams under docs/architecture are stale.
allowed-tools: Bash, Read, Edit
disable-model-invocation: true
---

# Diagrams Refresh

The repo ships rendered architecture diagrams under `docs/architecture/`. They drift fast. This skill regenerates them in the right order.

## Steps

1. Confirm the source diagrams exist:
   ```bash
   ls docs/diagrams docs/architecture 2>/dev/null
   ```

2. Regenerate from current `src/`:
   ```bash
   npm run diagrams:check
   npm run diagrams:modules
   npm run diagrams:md
   npm run diagrams:html
   ```

3. Show what changed:
   ```bash
   git diff --stat docs/architecture docs/diagrams
   ```

4. Update `docs/architecture/manifest.json` to bump the `generatedAt` field (or whatever timestamp/version field it uses — read it first to match its schema).

5. **Do not commit.** Print the staged changes and let the user review.

## Rules

- If `diagrams:check` (dependency-cruiser rule check) fails, **stop** and surface the violations. Do not regenerate visuals on top of broken architecture — fix the violations first.
- Don't edit `.dependency-cruiser.cjs` from this skill. Rule changes are out of scope.
