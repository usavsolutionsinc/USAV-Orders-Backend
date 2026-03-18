# 07 — Phase Rollout, Priorities & Completion Checklist

---

## Rollout Strategy

Each phase is **independently deployable**. No phase depends on the next being complete. Phases 4–6 can run in parallel once Phases 1–3 are done.

---

## Phase Timeline

```
Week 1   ████████░░░░░░░░░░░░  Phase 1: Dead Code Cleanup
Week 2   ░░░████████░░░░░░░░░  Phase 2: Utils Consolidation
Week 3   ░░░░░░████████░░░░░░  Phase 3: Hooks Consolidation
Week 4   ░░░░░░░░████░░░░░░░░  Phase 4: Caching Strategy
         ░░░░░░░░████░░░░░░░░  Phase 5: Form Autosave  ← parallel with 4
         ░░░░░░░░████████░░░░  Phase 6: Neon DB Fetch  ← can start earlier
Week 5   ░░░░░░░░░░░░░░████░░  Final QA + Regression
```

---

## Phase 1 — Dead Code Cleanup

**Estimated time:** 3–5 days  
**Risk:** Low — deletions only, no logic changes  
**Blocking:** Yes — must complete before all other phases

### Steps

- [ ] Install `knip` and `eslint-plugin-unused-imports`
- [ ] Run initial `knip` audit — catalogue all dead exports
- [ ] Remove empty wrapper components
- [ ] Remove unused Framer Motion variants
- [ ] Delete commented-out code blocks older than 30 days
- [ ] Fix all Tailwind dynamic class interpolations
- [ ] Add `knip` to CI pipeline
- [ ] Final `knip` run: zero unused exports

---

## Phase 2 — Utils Consolidation

**Estimated time:** 2–3 days  
**Risk:** Low — pure refactor, no logic changes  
**Blocking:** Yes — hooks depend on `@/utils` (`safeAwait`, `retry`)

### Steps

- [ ] Run util audit (`find` + `grep`)
- [ ] Create `src/utils/` directory structure
- [ ] Populate all `_*.ts` util files
- [ ] Create `index.ts` barrel
- [ ] Install `clsx` + `tailwind-merge`
- [ ] Replace all `classnames`/manual joins with `cn()`
- [ ] Update all import paths to `@/utils`
- [ ] Delete original util files
- [ ] `tsc --noEmit` passes
- [ ] `knip` reports clean

---

## Phase 3 — Hooks Consolidation

**Estimated time:** 3–4 days  
**Risk:** Medium — touching many component files  
**Blocking:** Yes — caching and form hooks depend on consolidated base hooks

### Steps

- [ ] Run hook audit (`find` + `grep`)
- [ ] Create `src/hooks/` directory structure
- [ ] Migrate all hooks to category `_*.ts` files
- [ ] Create `index.ts` barrel
- [ ] Update all component imports to `@/hooks`
- [ ] Delete original hook files
- [ ] `tsc --noEmit` passes
- [ ] `knip` reports clean
- [ ] Manual smoke test of all major UI flows

---

## Phase 4 — Caching Strategy

**Estimated time:** 2–3 days  
**Risk:** Medium — changes data fetching behaviour  
**Parallel with:** Phase 5

### Steps

- [ ] Create `src/lib/cache.ts`
- [ ] Create `src/lib/cacheDomains.ts`
- [ ] Add `useCache` hook to `src/hooks/_cache.ts`
- [ ] Migrate all data-fetching components to `useCache`
- [ ] Add `cacheInvalidate` calls to all mutation handlers
- [ ] Define TTL per domain in `cacheDomains.ts`
- [ ] Verify window event propagation across component tree
- [ ] Test: edit one entity, confirm other mounted instances refetch

---

## Phase 5 — Form Autosave

**Estimated time:** 2–3 days  
**Risk:** Low-Medium — localStorage behaviour is additive  
**Parallel with:** Phase 4

### Steps

- [ ] Create `src/lib/storageKeys.ts`
- [ ] Add `useAutoSaveForm` to `src/hooks/_form.ts`
- [ ] Add `useUnsavedWarning` hook
- [ ] Migrate all forms to `useAutoSaveForm`
- [ ] Assign scoped storage keys to all entity-edit forms
- [ ] Verify draft restore on page refresh for all forms
- [ ] Verify draft clears on successful submit
- [ ] Verify `beforeunload` warning fires when form is dirty
- [ ] Verify DB save errors surface in UI

---

## Phase 6 — Neon DB Fetch Improvements

**Estimated time:** 3–4 days  
**Risk:** Medium — DB access changes require careful testing  
**Can start:** After Phase 2 (needs `safeAwait`, `retry` from utils)

### Steps

- [ ] Install `@neondatabase/serverless`
- [ ] Create `src/lib/db.ts` with `sql`, `pool`, `query`, `transaction`
- [ ] Create `src/lib/queries/` directory
- [ ] Create domain query files (users, posts, etc.)
- [ ] Migrate all DB calls to typed query functions
- [ ] Add cache integration to high-frequency reads (`getCachedUser`, etc.)
- [ ] Add `LIMIT` to all list queries
- [ ] Convert double-fetch patterns to `RETURNING`
- [ ] Add `VITE_DATABASE_URL` to `.env.example`
- [ ] Test: all CRUD operations work correctly
- [ ] Test: transaction rollback on error
- [ ] Test: cached reads serve from cache on second call

---

## Final QA Checklist

### Functional

- [ ] All pages load without console errors
- [ ] All forms save drafts to localStorage
- [ ] All forms restore drafts on refresh
- [ ] All forms clear drafts on submit
- [ ] Cache invalidation propagates across mounted components
- [ ] DB queries use parameterised inputs (no string concatenation)
- [ ] Transactions roll back correctly on error

### Code quality

- [ ] `tsc --noEmit` — zero type errors
- [ ] `npx knip` — zero unused exports
- [ ] `npx eslint src` — zero errors
- [ ] No duplicate hook definitions
- [ ] No duplicate util functions
- [ ] All imports use `@/hooks` and `@/utils` aliases

### Performance

- [ ] No waterfall fetches (parallel where possible)
- [ ] All list queries paginated
- [ ] Cache hit rate > 80% on repeated entity reads (check DevTools Network tab)
- [ ] No unnecessary re-renders on unrelated state changes

### Security

- [ ] All DB queries use tagged template literals (not string interpolation)
- [ ] `VITE_DATABASE_URL` not committed to repo
- [ ] No sensitive data in `localStorage` (IDs only, no tokens/passwords)

---

## Tooling Summary

| Tool | Purpose |
|------|---------|
| `knip` | Detect unused files, exports, dependencies |
| `eslint-plugin-unused-imports` | Auto-remove unused imports |
| `clsx` + `tailwind-merge` | Safe Tailwind class merging |
| `@neondatabase/serverless` | Neon DB HTTP/WebSocket client |
| `tsc --noEmit` | TypeScript type checking |

---

## Architecture Overview (Post-Improvement)

```
src/
├── lib/
│   ├── cache.ts          ← singleton cache store + invalidation events
│   ├── cacheDomains.ts   ← domain constants
│   ├── db.ts             ← Neon client (sql, pool, query, transaction)
│   ├── storageKeys.ts    ← localStorage key registry
│   └── queries/
│       ├── users.ts
│       ├── posts.ts
│       └── ...
├── hooks/
│   ├── index.ts          ← barrel export
│   ├── _cache.ts
│   ├── _data.ts
│   ├── _form.ts
│   ├── _lifecycle.ts
│   ├── _storage.ts
│   └── _ui.ts
└── utils/
    ├── index.ts          ← barrel export
    ├── _async.ts
    ├── _array.ts
    ├── _cn.ts
    ├── _date.ts
    ├── _number.ts
    ├── _object.ts
    ├── _string.ts
    ├── _url.ts
    └── _validation.ts
```
