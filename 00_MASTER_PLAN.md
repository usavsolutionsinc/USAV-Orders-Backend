# 🏗️ Sitewide Codebase Improvement Plan
> Stack: React · Framer Motion · Tailwind · Neon DB

---

## Overview

This document is the master index for a phased, comprehensive codebase improvement initiative. Each section has its own dedicated plan file with implementation details, code patterns, and migration steps.

---

## Plan Files

| # | File | Focus Area |
|---|------|------------|
| 01 | `01_DEAD_CODE_CLEANUP.md` | Removing dead code, empty wrappers, and unused imports |
| 02 | `02_HOOKS_CONSOLIDATION.md` | Merging all hooks into a single organised hook file |
| 03 | `03_UTILS_CONSOLIDATION.md` | Merging all utility/formatting helpers into one utils file |
| 04 | `04_CACHING_STRATEGY.md` | ID-keyed caching + window listener-based invalidation |
| 05 | `05_FORM_AUTOSAVE.md` | Auto-saving forms to localStorage + async DB sync |
| 06 | `06_NEON_DB_FETCH.md` | Improved Neon DB fetch logic, pooling, and error handling |
| 07 | `07_PHASE_ROLLOUT.md` | Phased rollout order, priorities, and completion checklist |

---

## Guiding Principles

1. **No big-bang rewrites** — each phase is independently deployable.
2. **Backwards-compatible** — existing APIs and component interfaces are preserved during migration.
3. **One source of truth** — hooks, utils, and cache live in single, well-documented files.
4. **Optimistic UI** — local state and localStorage update first; DB syncs asynchronously.
5. **Fail loudly in dev, fail gracefully in prod** — errors surface in development but degrade cleanly for users.

---

## Priority Order

```
Phase 1 → Dead Code Cleanup          (unblocks everything else)
Phase 2 → Utils Consolidation        (needed before hooks refactor)
Phase 3 → Hooks Consolidation        (depends on clean utils)
Phase 4 → Caching Strategy           (depends on consolidated hooks)
Phase 5 → Form Autosave              (depends on caching layer)
Phase 6 → Neon DB Fetch Improvements (runs in parallel with 4–5)
```

---

## Success Metrics

- [ ] Zero duplicate hook definitions across codebase
- [ ] Zero duplicate util/formatter functions
- [ ] All cache reads are ID-keyed (`cache[id]` pattern)
- [ ] All forms persist to localStorage on every `onChange`
- [ ] All DB writes are non-blocking (fire-and-forget with retry)
- [ ] Neon DB connection pooling enabled on all routes
- [ ] Dead code scanner (e.g. `knip`) reports zero unused exports
