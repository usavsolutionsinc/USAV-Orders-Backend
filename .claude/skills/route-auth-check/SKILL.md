---
name: route-auth-check
description: Run the route-auth audit and surface any new unprotected API routes. Use before committing changes that touch src/app/api or the permission registry.
allowed-tools: Bash, Read
disable-model-invocation: true
---

# Route Auth Check

One-shot guard against accidentally shipping an unprotected API route.

## Steps

1. Run the project's existing audit in check mode:
   ```bash
   npm run audit-route-auth:check
   ```
2. If exit code is non-zero, capture the output. Identify which routes are newly unprotected vs. pre-existing.
3. Run `git diff --name-only origin/main...HEAD -- 'src/app/api/**/route.ts'` to scope to routes touched on this branch.
4. Intersect: report only newly unprotected routes that the current branch added or modified.

## Output

If clean:
```
✓ audit-route-auth:check passed — no unprotected routes on this branch
```

If not:
```
✗ Unprotected routes introduced or modified on this branch:
  - src/app/api/<path>/route.ts   (handlers: GET, POST)
  - ...
Fix: wrap each handler with the permission-registry guard from src/lib/api-guard.ts,
or, if intentionally public, register it in the public-routes manifest.
```

Do not auto-fix. The skill reports — the user (or a follow-up Claude run) decides how to remediate.
