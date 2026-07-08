# Commit summary & push runbook

## Commit summary template

```markdown
## Summary
<one-line what changed>

## Why
<bug / isolation / attribution issue being fixed>

## Risk / impact
- <API breaking: receiving-lines no longer serves view=testing>
- <DB: none | migration>
- <UX: ...>

## Test plan
- [ ] `pnpm test:unit` (surface-isolation, receiving-modes)
- [ ] Manual: /unbox + /test isolation
- [ ] `tests/e2e/receiving-lines-endpoints.spec.ts`
```

## This change (reference)

### Summary
Isolate Testing from Receiving/Unbox at URL, API, and storage layers; harden actor attribution to session staff only.

### Why
Package pairing / testing mode was leaking into unbox & receiving timelines (wrong operators, shared feeds).

### Risk / impact
- **Breaking:** `GET /api/receiving-lines?view=testing|needs-test` returns 403 — clients must use `/api/testing/receiving-lines`
- **TEST tracking:** `TEST*` lookup-po shortcut limited to QA org unless `ALLOW_TEST_TRACKING=true`
- **Low:** localStorage keys namespaced by org (legacy keys still read)

### Test plan
- Unit: `src/lib/surface-isolation.test.ts`
- E2E: `receiving-lines-endpoints.spec.ts`, `receiving-tech-modes.spec.ts`

## Steps to commit & push

> Repo rule: work on `main`. User may commit via GitHub Desktop mid-session — **do not `git stash`**.

1. Review diff: receiving routes, testing API, surface hooks, docs
2. Run checks:
   ```bash
   pnpm test:unit -- src/lib/surface-isolation.test.ts src/lib/receiving/receiving-modes.test.ts
   ```
3. Commit on `main`:
   ```bash
   git add -A
   git commit -m "fix(receiving): isolate testing surface and trust session actor

   - Block view=testing on /api/receiving-lines; add /api/testing/receiving-lines
   - Path-first history mode; strip cross-surface URL params
   - Gate TEST* lookup-po to QA org; org-scope localStorage scratch keys
   - Ignore client staff_id/staff_name on receiving write routes
   - docs: testing-vs-receiving-isolation, actor attribution, commit runbook"
   ```
4. Push:
   ```bash
   git push origin main
   ```

## Post-push verification

1. Production: open a real carton on `/unbox` — Progress tab actors match current session
2. `/test?view=testing` — rails load via testing API
3. No `view=testing` in network tab on `/unbox` page loads
