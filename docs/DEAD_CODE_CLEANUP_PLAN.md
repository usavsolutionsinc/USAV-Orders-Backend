# Dead Code Identification & Safe Cleanup Plan

**Owner**: Engineering team  
**Status**: Active — living document  
**Last updated**: 2026-06 (initial build-out)  
**Goal**: Reduce maintenance burden, improve build times, lower cognitive load, and make the codebase easier to reason about without breaking production workflows.

This plan is **concrete and executable**. It prioritizes low-risk, high-signal work first and requires explicit verification at every step.

## Principles

1. **Never delete on tool output alone** — always human triage + build + targeted test.
2. **Small, reviewable waves** — prefer many tiny PRs over one giant cleanup.
3. **Preserve history** — move rather than delete when in doubt (archive dirs, comments).
4. **Tie to real transitions** — Inventory V2 flags, SAL migration, multi-tenancy, QStash → Vercel Cron, etc.
5. **Improve detection over time** — make the tools stricter as we clean the baseline.
6. **Document everything** — every significant deletion gets an entry in the triage log.

## Current Baseline (as of plan creation)

- **Knip reports**: 182 unused files (many require triage — mobile components, old receiving modes, admin sub-pieces, FBA table fragments, etc.).
- **No root ESLint config**: `eslint-plugin-unused-imports` is installed but inert.
- **Obvious surface junk**: `apps/desktop/` (11k node_modules files), huge committed logs + JSON backups, old token scripts, root plan docs, one-off diag scripts.
- **Legacy surface**: Setup/bootstrap routes (`setup-db`, `drizzle-setup`, etc.) still exist and are heavily gated.
- **Dual paths**: Many Inventory V1 implementations behind `isInventoryV2*` flags.
- **Deprecated structures**: Old "Shipped table" references in schema + comments.
- **Good existing signals**: `dependency-cruiser` (with `no-orphans` rule), rich `context/` and `docs/` explaining historical refactors.

## Phase Overview

| Phase | Focus | Risk | Estimated Effort | Primary Tools |
|-------|-------|------|------------------|---------------|
| 0 | Tooling activation + baseline reports | Low | 1–2 days | ESLint config, knip, depcruise, script |
| 1 | Obvious surface junk (root, build artifacts, scripts) | Very Low | 0.5 day | `git rm`, archive dirs |
| 2 | Legacy diagnostic / bootstrap surface | Low–Medium | 1 day | Code review + docs updates |
| 3 | Systematic static analysis + triage | Medium | Ongoing (waves) | Knip + ESLint + depcruise |
| 4 | Domain-specific historical dead code | Medium–High | Ongoing | Feature flags, schema comments, workflow docs |
| 5 | Deeper / behavioral detection | Medium | As needed | Route reachability, import graph, runtime |
| 6 | Removal workflow & verification (mandatory) | — | Every wave | Build + tests + smoke |
| 7 | Prevention & guardrails | Low | Continuous | CI, lint rules, conventions |

---

## Phase 0: Tooling Activation & Baseline Capture (Highest Leverage)

### 0.1 Create / Activate ESLint Config (currently missing)

Create `eslint.config.mjs` at root that:
- Uses Next.js recommended flat config
- Enables `eslint-plugin-unused-imports`
- Turns on `no-unused-vars` with the plugin's replacement
- Reasonable baseline rules for a large TS React codebase

**Action items**:
- Create the config file.
- Add `lint:deadcode` or strengthen the existing `lint` script.
- Run `npm run lint -- --fix` and review the diff.

### 0.2 Improve Knip Configuration

Current `knip.config.ts` is too loose. Improvements:
- Better entry points (include API routes, mobile, lib that are not page-level).
- Explicit ignore for known transitional areas (`design-demo`, certain legacy admin pieces, test files already ignored).
- Add `workspaces` if needed in future (currently single package).
- Produce both compact and JSON reports.

See the updated `knip.config.ts` after edits.

### 0.3 Create a Dead Code Report Generator

Create `scripts/generate-dead-code-report.mjs` that runs:
- `knip --reporter json`
- Dependency-cruiser orphans focus
- `npm run lint` (once active)
- Basic file size / root junk scan
- Outputs a human-readable `reports/dead-code-YYYY-MM-DD.md` + JSON for further processing.

### 0.4 Capture First Baseline

Run and commit (or .gitignore large reports):
```bash
npm run dead-code:report
```

### 0.5 Initial Triage Document

Create `docs/dead-code-triage.md` with:
- Quick wins table (pre-filled)
- Full knip unused files (as of baseline)
- Columns: Path, Category, Confidence, Evidence, Proposed Action, Status, Notes

---

## Phase 1: Obvious Surface Junk (Do Immediately)

### 1.1 Root-level files (very safe)

Delete or archive:
- `firebase-debug.log`
- `receiving_lines_cleanup_backup_*.json` (both)
- `Repair Service HTML`
- `get-all-ebay-tokens.js`
- `get-ebay-tokens.js`
- `test-packing-flow.sh`
- `upload-env-to-vercel.sh` (review first)
- `.test-artifacts/`, `.tmp/`, `.tmp-e2e/`, old `playwright-report/`, `test-results/` (if not needed for CI)

### 1.2 Build artifacts

- `apps/desktop/` — entire directory (contains only `node_modules` from a prior electron build). This should never have been committed.

### 1.3 Root plan documents

Move the following into `docs/archive/plans/` (with a README explaining they are historical):
- `ARCHITECTURE_PLAN.md`
- `COMPONENT_DEDUP_PLAN.md`
- `FBA_ALIGNMENT_PLAN.md`
- `FBA_UX_UI_CONSISTENCY_PLAN.md`
- `fba_tracker_plan.docx`
- Any other top-level `*_PLAN.md` that are >3 months old and not actively referenced.

Keep recent/active plans at root or in `docs/`.

### 1.4 Scripts hygiene

In `scripts/`:
- Many `diag-*`, `debug-*`, `inspect-*`, `backfill-*`, `verify-*` are one-time.
- Strategy: Move anything older than a specific date or without recent usage into `scripts/archive/`.
- Add a header convention for new scripts:
  ```js
  // ONE-TIME MIGRATION SCRIPT — run date: YYYY-MM-DD
  // Purpose: ...
  // Can be deleted after: YYYY-MM-DD
  ```

**Verification for Phase 1**: `git status`, `npm run build`, basic smoke of main pages.

---

## Phase 2: Legacy Diagnostic & Bootstrap Routes

### Routes to address

- `src/app/api/setup-db/route.ts`
- `src/app/api/drizzle-setup/route.ts`
- `src/app/api/migrate-process/route.ts`
- `src/app/api/diagnose-migration/route.ts`
- `src/app/api/setup-source-db/route.ts`
- Related guard: `src/lib/setup-guard.ts`

**Recommended path** (as of 2026):
- The modern path is `npm run db:migrate` + `drizzle-kit` + pending migrations runner.
- These routes are break-glass / historical.

**Options** (decide per route):
A. Delete entirely + update all references in README, `context/`, `docs/`, `docs/security/route-permissions.json`, audit scripts.
B. Keep but return 410 Gone with a clear message and remove the heavy implementation.
C. Move implementation to `scripts/` and keep a minimal authenticated stub.

Strongly prefer **A or B** for most of them. They are called out repeatedly as security/operational risk in internal docs.

Also clean:
- `src/config/qstash-schedules.json` — remove or clearly mark entries with `"managedBy": "vercel"`. Update bootstrap scripts to ignore them.

**Verification**: Update `docs/auth-coverage.md`, README, any diagrams that reference the old endpoints. Run auth audit scripts after changes.

---

## Phase 3: Systematic Static Analysis + Triage Waves

### How to run analysis

After Phase 0 tooling:
```bash
# Quick
npm run dead-code:knip
npm run dead-code:depcruise

# Full report
npm run dead-code:report
```

### Triage guidelines for the ~182 knip "unused files"

Common categories observed in baseline:
- **Mobile components** (`components/mobile/*` many subdirs) — check if used by `src/app/m/**` or dynamic mobile flows. Some may be from a previous redesign.
- **Old receiving modes** (`Mode1BulkScan`, `Mode2Unboxing`, `Mode3LocalPickup`, `PODetailPanel`, etc.) — likely superseded by workspace + triage modes.
- **FBA table fragments** and small utils — many small files under `components/fba/table/*`.
- **Admin pieces** (`ManualAssignmentTable`, `OrdersManagementTab`, `StaffTable`, various connection cards) — may be used via admin section routing.
- **Manuals-related** — several components around pairing and sidebars.
- **Electron chrome** (`ElectronTitleBar`, `UpdaterButton`) — only relevant in desktop shell.
- **Design system experiments / old shared** — `DocxUploader`, `StaffSelector`, `TechSearchPanel`, etc.

**Process per wave**:
1. Pick a category (e.g., "old receiving modes").
2. Search for all imports + dynamic references.
3. Check sidebar navigation, route permission manifest, and mobile nav.
4. If truly unreachable → propose deletion.
5. Update any barrel exports (`index.ts`).

### Knip false-positive mitigation

- Knip sometimes misses code reached via:
  - Dynamic `import()`
  - Route handlers that are only hit by crons / webhooks / external systems
  - Mobile PWA entry points
  - Design system consumers that use specific subpaths
- Always cross-check with `grep -r "from ['\"].*ComponentName" --include="*.ts*" src/`

---

## Phase 4: Domain & Historical Dead Code

### 4.1 Inventory V2 dual implementations

Location: `src/lib/feature-flags.ts` + call sites using `isInventoryV2*` / `isInventoryV2*ForOrg`.

Current active flags (as of plan):
- Receiving putaway, Tech lifecycle, Allocation, Packing, FBA serial link, Returns, Picking, Bin roles, Replenishment, RMA, Legacy pack mirror, Mobile receiving pipeline V2.

**Strategy**:
- While any flag is still `false` for the primary org → keep both paths.
- Once a flag is permanently `true` in production for all active tenants:
  - Delete the V1 `else` branch.
  - Remove the flag function.
  - Clean up any "mirror" code (e.g. `isInventoryV2LegacyPackMirror`).
- Add prominent comments in code:
  ```ts
  // LEGACY V1 — delete after INVENTORY_V2_XXX is permanently enabled for all orgs
  if (isInventoryV2XXX()) { ... } else { /* V1 */ }
  ```

Consider a future refactor to move remaining V1 code into `src/lib/legacy/inventory-v1/` once the cutover is complete.

### 4.2 Deprecated "Shipped" table & related

- Schema comment in `src/lib/drizzle/schema.ts`: "Shipped table - DEPRECATED"
- Various comments and some `shipped/` API routes still reference old patterns.
- Current reality: `orders` + `shipping_tracking_numbers` + packer logs + `useShippedSearch` etc.

**Work**:
- Audit all references to any old `shipped` table (distinct from the modern "Shipped" dashboard view).
- Remove or clearly mark as archive-only any remaining direct queries.
- Update `src/lib/source-schema.sql` and migration history docs.

### 4.3 Old workflow concepts

Search for remnants of the "task templates + tags + daily checklist" system mentioned in the README as previous architecture. Most should already be gone.

### 4.4 Legacy setup & source schema files

- `src/lib/source-schema.sql`
- `src/lib/schema.sql`
- Old migration snapshots in root or `receiving_lines_cleanup_backup*` (already targeted in Phase 1)

---

## Phase 5: Deeper Detection Techniques

- **Route reachability map**: Combine sidebar navigation (`src/lib/sidebar-navigation.ts`), `ROUTE_PERMISSIONS`, mobile nav, cron definitions (`vercel.json`), qstash schedules, and webhook handlers. Any API route not on this map is suspect.
- **Component usage via codemods or better static analysis** (e.g. `ts-morph` script in the future).
- **Bundle analysis** after builds: look for chunks that are never loaded.
- **Auth coverage script** (`scripts/audit-route-auth.ts`) — extend it to also flag routes with no permission entry or no UI call site.
- **Feature flag usage audit**: Find flags that are only ever `false` or never read.

---

## Phase 6: Removal Workflow (Mandatory for Every Change)

**Checklist for any dead-code PR**:

- [ ] Branch: `chore/dead-code-wave-N-YYYYMMDD-shortdesc`
- [ ] Delete / move files
- [ ] Update all cross-references (imports, barrels, docs, README, diagrams, security manifests, package.json scripts)
- [ ] Run verification suite:
  ```bash
  npm run build
  npm run lint
  npx tsc --noEmit
  npm run test:auth          # or relevant test suites
  npm run diagrams:check
  ```
- [ ] Targeted smoke test of affected area (e.g. Receiving workspace, FBA board, Tech station, Admin sections)
- [ ] Add entry to `docs/dead-code-triage.md`
- [ ] Update any internal context files that reference the removed code
- [ ] PR description includes "Dead code removal — low risk" + link to triage entry

**Never** delete in the same PR as new feature work.

---

## Phase 7: Prevention & Continuous Hygiene

### 7.1 Tooling that should stay strict

- `eslint.config.mjs` with `unused-imports/no-unused-imports: "error"`
- `knip` in CI (start as warning, move to error after baseline clean)
- `dependency-cruiser` (already has `no-orphans` and design-system boundary rules — keep/enhance)

### 7.2 New code conventions

- Every new top-level component or lib module must be reachable from an entry point within 2 weeks or be clearly marked experimental.
- New one-off scripts go in `scripts/archive/` or get a deletion date comment.
- New feature flags must document the removal condition in `feature-flags.ts`.
- Large generated files (logs, backups, reports) must be gitignored or written to `reports/` (which can be gitignored for large artifacts).

### 7.3 CI / Automation ideas (future)

- Add a weekly "dead code report" comment on a tracking issue.
- GitHub Action that fails PRs introducing new orphans (after we have a clean baseline).
- Regular "hygiene day" (1 engineer, ½ day) to process the triage backlog.

### 7.4 Documentation maintenance

- Keep `docs/dead-code-triage.md` up to date.
- When a whole subsystem is cleaned (e.g. old receiving modes), add a short note in the relevant `context/WORKFLOW-*.md` or `docs/`.

---

## Quick Start Commands (after Phase 0)

```bash
# One-time setup
npm install   # ensure all dev deps

# Generate current view
npm run dead-code:report

# Focus on one tool
npx knip --reporter compact
npx depcruise src --config .dependency-cruiser.cjs --output-type text

# After changes
npm run build && npm run lint && npx tsc --noEmit
```

---

## Tracking & Success Metrics

- Number of "unused files" reported by knip (target: trend down, with documented reasons for remaining).
- Size of root directory and `scripts/`.
- Number of legacy diagnostic routes still carrying heavy implementation.
- Build time / bundle size (secondary signal).
- Developer anecdotal feedback ("I can find the real code faster").

Create a tracking issue or use the triage document + labels on PRs (`dead-code`, `hygiene`).

---

## Appendix: High-Confidence Early Candidates (Baseline)

**Delete / archive with very low risk**:
- `apps/desktop/`
- `firebase-debug.log`
- Both `receiving_lines_cleanup_backup_*.json`
- `Repair Service HTML`
- Old ebay token getter scripts
- `src/app/design-demo/` (self-describes as throwaway in its own page.tsx)
- Most root `*_PLAN.md` files (move to archive)

**High triage priority categories** (from initial knip run):
- Old receiving mode components (`Mode1*`, `Mode2*`, `Mode3*`, `PODetailPanel`, `ZohoPOManager`, etc.)
- Large chunks of `components/mobile/*` that are not imported by `src/app/m/`
- Various small FBA table subcomponents
- Several admin cards and tables that may be superseded by newer admin sections
- `components/manuals/*` pieces around the old pairing/manual UI (products page has taken over)

See `docs/dead-code-triage.md` for the full living list.

---

**Progress**: Phase 0 tooling + initial reports completed. **First Phase 1 surface junk wave executed** (root junk files removed from disk, `apps/desktop/` cleaned, `src/app/design-demo/` git-deleted, historical root plans moved to `docs/archive/plans/` with README). See `docs/dead-code-triage.md` for details and `git status`.

**Next actions**: 
- Commit the wave as a reviewable set of changes.
- Continue triaging the remaining knip list (176 files).
- Run `npm run lint` to start addressing unused imports now that the config is live.
- Proceed to Phase 2 (legacy routes) or more waves from Phase 3.

This plan was built from direct codebase inspection (knip output, schema comments, feature flag structure, sidebar source of truth, existing audit scripts, and internal documentation).
