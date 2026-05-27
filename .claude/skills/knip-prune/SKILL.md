---
name: knip-prune
description: Run knip against the repo and surface unused files, exports, and dependencies. Use periodically to keep the ~1,694 TS/TSX file surface area tidy.
allowed-tools: Bash, Read, Edit
disable-model-invocation: true
---

# Knip Prune

Wraps `npx knip` (config: `knip.config.ts`) and surfaces actionable cleanup.

## Steps

1. Run knip in report mode:
   ```bash
   npx knip --reporter compact
   ```

2. Group findings by type:
   - Unused files
   - Unused exports
   - Unused dependencies / devDependencies
   - Unlisted dependencies (used but not declared)

3. For each group, show the top 20. If the list is longer, note the total count.

4. **Do not auto-delete.** Stop and ask the user which categories to act on. For each accepted item:
   - Unused file → propose `rm <path>`, show callers via grep first to confirm.
   - Unused export → propose making it non-exported (delete the `export` keyword), not deleting the symbol.
   - Unused dep → propose `npm uninstall <pkg>`.

5. After any removals, re-run knip to confirm the count dropped and nothing else broke.

## Rules

- Never delete files under `scripts/_diag-*` — those are intentionally one-shot diagnostics.
- Never delete files matching `*.test.ts`, `tests/e2e/**`, or anything under `electron/` without explicit confirmation; knip can misjudge entry points there.
- If knip flags something in `src/lib/auth/permission-registry.ts` or `src/lib/api-guard.ts`, treat as a false positive — those are referenced via route metadata that knip can't trace.
