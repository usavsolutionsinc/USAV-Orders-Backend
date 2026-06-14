# USAV — Uncommitted Changes Test Checklist

**Purpose:** A pre-commit QA to-do list covering **every uncommitted change** in the working
tree as of **2026-06-13**. Work top-to-bottom. Check each box (`[x]`) only when the test
passes. Anything that fails → note it in the **Findings** column at the bottom of each section.

**Scope of this changeset (measured):** 241 modified tracked files · 216 untracked · 3 staged
· ~4,266 insertions / 4,259 deletions. The bulk is a **multi-tenancy hardening refactor**
(org-scoped realtime across ~96 API routes) layered with several **new feature systems**
(Operations Studio, Station Builder, Workflow Node Engine, Sourcing Hub, Receiving intake
type, Tech/Testing station, Staff Messages, Outbound scan-out, Warranty↔Zendesk).

> **How to use:** `[ ]` = not done · `[~]` = in progress / partial · `[x]` = pass · `[!]` =
> FAIL (log it). Each feature section lists: **Migrations** to apply, **Automated** commands,
> **Manual** test cases, and **Regression risks** to spot-check.

---

## 0 · Global pre-flight (run once, must be green before feature testing)

- [ ] **Clean install matches lockfile** — `npm ci` (or `npm install`) succeeds; `package.json`/`package-lock.json` diffs are intentional.
- [ ] **Type check** — `npx tsc --noEmit` passes with zero errors.
- [ ] **Lint** — `npm run lint` passes (or only pre-existing warnings).
- [ ] **Production build** — `npm run build` completes (Next.js + webpack).
- [ ] **Dependency graph** — `npm run diagrams:check` (depcruise) has no new violations.
- [ ] **All migrations preview cleanly** — `npm run db:migrate:dry` lists the 13 new migrations in order, no errors.
- [ ] **Migrations apply** (against a **test/branch DB**, never prod first) — `npm run db:migrate` runs all pending to completion; re-running is a no-op (idempotent).
- [ ] **Route auth manifest** — `npm run audit-route-auth:check` green (every new route is registered / public-listed).
- [ ] **Permission registry** — `npm run audit-permissions` green; `npm run test:auth` passes (`permission-registry`, `permissions-shared`, `route-permission-manifest`).
- [ ] **Env sanity** — `.env` / `.env.local` changes reviewed; no secrets accidentally committed; required new vars documented (check `.env` diff).
- [ ] **CI config** — `.github/workflows/ci.yml` + `eslint.config.mjs` + `vercel.json` diffs reviewed and intentional.

**Findings:** _______________________________________________

---

## 1 · 🔴 Multi-tenancy hardening (HIGHEST RISK — the cross-cutting refactor)

**What changed:** ~96 API routes now thread `ctx.organizationId` into realtime publish calls;
`src/lib/realtime/channels.ts` + `publish.ts` + `db-events.ts` + `walkin-events.ts` rewritten
for org-scoped channels; new RLS infra migration; new tenancy audit tooling + isolation tests.

**Files:** `src/lib/realtime/*`, `src/lib/tenancy/cross-org-harness.ts`,
`src/lib/tenancy/cross-org-isolation.test.ts`, all `src/app/api/**/route.ts` realtime callers,
`scripts/tenancy-*.{mjs,ts}`, `docs/tenancy/*`.
**Migrations:** `2026-06-14_rls_enforcement_infra.sql` (no-op at runtime on its own),
`2026-06-21_app_tenant_role.sql.template` (review — template, applied manually).

### Automated
- [ ] **Cross-org isolation suite** — `tsx --test src/lib/tenancy/cross-org-isolation.test.ts` passes (org A cannot read/write org B).
- [ ] **Tenancy coverage** — `npm run tenancy:coverage` — review `docs/tenancy/org-id-coverage.generated.md`; no business table regressed to un-scoped.
- [ ] **Route scoping audit** — `npm run tenancy:routes` — review `docs/tenancy/route-scoping-audit.generated.md` for unscoped handlers.
- [ ] **Tenancy guard** — `npm run tenancy:guard:check` passes.
- [ ] **Realtime token e2e** — `npm run test:e2e:realtime-token` passes (token mints scoped to the right org channel).

### Manual
- [ ] **Channel isolation** — with two orgs open in two browsers, an action in org A's dashboard does **not** push a realtime update into org B (orders, FBA board, receiving, walk-in, tech). Spot-check 3–4 channels.
- [ ] **No regression on same-org realtime** — within one org, live updates still arrive (order changed, FBA shipment changed, scan log, inbox).
- [ ] **`publishOrderChanged` / `publishFbaShipmentChanged` / walk-in events** all carry `organizationId`; subscribers on the wrong org get nothing.
- [ ] **RLS infra migration is inert** — applying `2026-06-14_rls_enforcement_infra.sql` does **not** break existing reads/writes (it's enforcement scaffolding, not yet active). Confirm app still works post-migration.
- [ ] Review `docs/tenancy/_analysis/*` (critique, cron, realtime, repos, routes, tables) against the actual diff — no claimed-scoped-but-actually-unscoped path.

**Regression risks:** a route that forgot the `organizationId` arg → silent realtime
mis-delivery; cron jobs that publish without an org context; the `app_tenant_role` template
must NOT be auto-run by `db:migrate` (it's `.sql.template`).

**Findings:** _______________________________________________

---

## 2 · Operations Studio (`/studio`)

**What changed (new feature):** the `/studio` build/observe page — canvas, inspector, library,
live-heat overlay, diagnostics-gated publish.
**Files:** `src/app/studio/page.tsx`, `src/components/studio/*` (StudioShell, StudioCanvas,
StudioInspector, StudioLibrary, StudioStationPreview, studio-types), `src/components/sidebar/StudioSidebarPanel.tsx`,
`src/lib/studio/*` (live-heat, static-flow-graph, station-diagnostics), `src/lib/schemas/studio.ts`,
API: `/api/studio/{graph,live,definitions/draft,definitions/[id]/graph,definitions/[id]/publish,nodes/[id]/station}`.

### Automated
- [ ] `tsx --test src/lib/studio/live-heat.test.ts` passes.
- [ ] `tsx --test src/lib/studio/static-flow-graph.test.ts` passes.
- [ ] Studio verify scripts run clean: `tsx scripts/_verify-studio-shell.mjs`, `_verify-studio-st4.ts`, `_verify-studio-live.ts`, `_verify-studio-push.ts`, `_verify-studio-gaps.ts` (review each — these are the author's own gap checks).

### Manual
- [ ] `/studio` loads; canvas renders the seeded reseller graph (depends on §4 seed migration).
- [ ] **Draft → edit → publish** loop: create/modify a definition draft, run diagnostics, publish; diagnostics **gate** publish (a graph with gaps cannot publish).
- [ ] **Live lens / heat overlay** reflects real node throughput (depends on `node_stats` cron §4).
- [ ] **Inspector** edits a node and persists (`/api/studio/nodes/[id]/station`).
- [ ] Studio loads scoped to the **current org only** (ties to §1).
- [ ] Sidebar StudioSidebarPanel mode switching works (respects `?mode=` per sidebar-mode skill).

**Findings:** _______________________________________________

---

## 3 · Station Builder (composable station blocks)

**What changed (new feature):** `station_definitions` registry + block palette/config/render.
**Files:** `src/components/stations/*` (StationSlot, BlockRenderer, BlockPaletteOverlay,
BlockConfigSheet, blocks/ChecklistBlock, station-icons), `src/lib/stations/*` (contract,
registry, blocks/checklist.block, data-sources, actions, validate, index),
`src/lib/queries/station-queries.ts`, `src/lib/schemas/stations.ts`, API `/api/stations`,
`/api/stations/publish`.
**Migration:** `2026-06-11_station_definitions.sql`.

### Automated
- [ ] `tsx --test src/lib/workflow/station-nodes.test.ts` passes (station↔node binding).
- [ ] Station e2e helpers still pass: `npm run test:e2e:station-serial`, `npm run test:e2e:station-sku-pull`.

### Manual
- [ ] Receiving Incoming pilot station renders blocks; **click-to-add** a block from the palette works.
- [ ] **ChecklistBlock** renders, items toggle, state persists.
- [ ] Block **config sheet** opens, edits a block's config, saves; `/api/stations/publish` persists the definition.
- [ ] `validate.ts` rejects an invalid block config (bad data source / missing required field).
- [ ] Station definitions are **org-scoped** (ties to §1).

**Findings:** _______________________________________________

---

## 4 · Workflow Node Engine

**What changed (new feature):** thin-adapter node types over existing domain modules + node
stats + tap.
**Files:** `src/lib/workflow/nodes/*` (receiving, inspection, repair, list-ebay, pack, ship,
station-node), `src/lib/workflow/{diagnostics,node-stats,tap}.ts`, `src/lib/schemas` workflow,
API `/api/cron/workflow-node-stats`, `scripts/e2e-workflow-tap.ts`.
**Migrations:** `2026-06-03_workflow_graph_layer.sql` (modified), `2026-06-11b_seed_reseller_workflow_v1.sql`
(seed), `2026-06-11c_workflow_edges_target_idx.sql`, `2026-06-11d_workflow_node_stats.sql`,
`2026-06-12_item_workflow_state_def_idx.sql`.

### Automated
- [ ] `npm run test:workflow` passes (all `src/lib/workflow/*.test.ts`, incl. new `diagnostics.test.ts`, `station-nodes.test.ts`).
- [ ] `npm run test:e2e:workflow-tap` passes (item routes through nodes end-to-end).
- [ ] ⚠️ **Verify the modified `2026-06-03_workflow_graph_layer.sql` SHA** — if its checksum changed after being applied elsewhere, `scripts/_fix-wf-migration-sha.mjs` exists for a reason. Confirm the migration runner doesn't choke on an already-applied-but-edited file.

### Manual
- [ ] Seed migration `2026-06-11b` populates the reseller workflow v1 graph (Standard refurb-and-list / Returns triage) for the org.
- [ ] `/api/cron/workflow-node-stats` cron computes per-node throughput; results feed Studio live-heat (§2).
- [ ] Each node adapter (receiving/inspection/repair/list-ebay/pack/ship) routes an item correctly and emits the right outputs.

**Regression risk:** the edited `2026-06-03` migration — re-applying or checksum mismatch can
block all later migrations. Test the full `db:migrate` chain on a fresh branch DB.

**Findings:** _______________________________________________

---

## 5 · Sourcing Hub

**What changed (new feature):** eBay sourcing adapters + saved searches + scour cron.
**Files:** `src/lib/sourcing/adapters/*` (ebay, types, index), `src/lib/jobs/scour-watch.ts`,
`src/lib/neon/{sourcing-queries,sourcing-searches-queries}.ts`, `src/components/sourcing/SourceThisButton.tsx`,
API `/api/sourcing/saved-searches`, `/api/sourcing/saved-searches/[id]`, `…/[id]/run`,
`/api/cron/sourcing/scour`.
**Migrations:** `2026-06-13d_sourcing_demand_unify.sql`, `2026-06-13e_sourcing_saved_searches.sql`.

### Manual
- [ ] Create a **saved search** (`POST /api/sourcing/saved-searches`) → persists, lists, edits, deletes.
- [ ] **Run** a saved search (`…/[id]/run`) → returns eBay results via the adapter (or graceful error if no eBay token).
- [ ] **Scour cron** (`/api/cron/sourcing/scour`) runs without error; `scour-watch.ts` job behaves.
- [ ] **SourceThisButton** appears where expected and kicks off a search for a SKU/model.
- [ ] Demand-unify migration: confirm the unified sourcing demand view returns sane data.
- [ ] Saved searches are **org-scoped** (ties to §1).

**Findings:** _______________________________________________

---

## 6 · Receiving — intake type, line views, source-order link

**What changed:** carton-default intake type + per-line source-order linkage + viewed rail.
**Files:** `src/components/receiving/workspace/line-edit/hooks/*` (useReceivingType,
useReceivingLineCore, useUnboxLineController), `…/mode-registry.ts`,
`src/lib/receiving/carton-source-link.ts`, `src/components/sidebar/receiving/ReceivingViewedRail.tsx`,
API `/api/receiving-lines/view`, plus the many modified `src/components/receiving/*`.
**Migrations:** `2026-06-13b_receiving_intake_type.sql`, `2026-06-13c_receiving_line_views.sql`,
`2026-06-13c_receiving_lines_source_order.sql`.

### Manual
- [ ] **Carton type pill** edits the carton default intake type; per-line override still wins (`effectiveReceivingType` resolver).
- [ ] **Unbox flow** unchanged end-to-end (scan tracking → match PO → unbox lines).
- [ ] **Viewed rail** records and shows recently-viewed receiving lines (`/api/receiving-lines/view`).
- [ ] **Source-order link** on a line associates item-dependent returns/repairs correctly.
- [ ] `npm run test:shipping-status` passes (includes `delivered-unscanned.test.ts`).
- [ ] Mobile receiving (`check:mobile-endpoints` → `npm run check:mobile-endpoints`) integrity holds.
- [ ] Tech/receiving modes e2e: `playwright test tests/e2e/receiving-tech-modes.spec.ts`.

**Findings:** _______________________________________________

---

## 7 · Tech / Testing station

**What changed (new feature):** dedicated testing line workspace + verdict recording.
**Files:** `src/components/tech/*` (TestingLineWorkspace, TestingPanel, hooks/useTestingLineController,
testing-line-events), `src/lib/tech/recordTestVerdict.ts`, `src/lib/testing/resolve-testing-scan.test.ts`.

### Automated
- [ ] `tsx --test src/lib/testing/resolve-testing-scan.test.ts` passes.

### Manual
- [ ] Testing station scan resolves to the right unit/line; verdict (pass/fail/failure-mode) records via `recordTestVerdict`.
- [ ] Failure routes the unit to repair/part-out/as-is per the workflow (ties to §4 repair node).
- [ ] Tech-station inbox bell / needs-test signal still fires (realtime, ties to §1).

**Findings:** _______________________________________________

---

## 8 · Staff Messages + Clipboard History (header)

**What changed (new feature):** persistent staff-to-staff messages + client clipboard popover.
**Files:** API `/api/staff-messages`, `src/lib/neon/staff-messages-queries.ts`,
`src/lib/schemas/staff-messages.ts`, `src/components/quick-access/ClipboardHistoryPopover.tsx`,
`src/lib/clipboard-history.ts`.
**Migration:** `2026-06-13_staff_messages.sql`.

### Manual
- [ ] **Send-to-staff** message persists (`POST /api/staff-messages`) and arrives on the recipient's `inbox:{staffId}` channel.
- [ ] **Clipboard history popover** shows recent copies (client-only, via the `useCopyChip` choke-point); copying a chip adds to history.
- [ ] Messages are **org-scoped** (a staffId in another org never receives).

**Findings:** _______________________________________________

---

## 9 · Outbound / Shipped scan-out + Orders sync

**What changed (new feature + UI):** outbound state model + scan-out view + orders sync popover.
**Files:** API `/api/shipped/scan-out`, `src/components/shipped/{ShippedScanOutView,OutboundStatePill}.tsx`,
`src/lib/outbound-state.ts`, `src/components/unshipped/OrdersSyncPopover.tsx`, `src/hooks/useOrdersSync.ts`,
modified `src/components/{shipped,unshipped}/*`.

### Manual
- [ ] **Scan-out** an outbound package (`POST /api/shipped/scan-out`) transitions state; `OutboundStatePill` reflects it.
- [ ] **OrdersSyncPopover** triggers a sync (`useOrdersSync`) and shows progress/result.
- [ ] Shipped ↔ unshipped boards update live after scan-out (realtime, §1).
- [ ] `npm run test:zoho-fulfillment` passes (outbound ship-confirm reconciliation).

**Findings:** _______________________________________________

---

## 10 · Warranty ↔ Zendesk link

**What changed:** link a warranty claim to a Zendesk thread + candidate matching.
**Files:** API `/api/warranty/claims/[id]/zendesk/link`, `src/lib/zendesk-link-candidates.ts`,
`src/lib/zendesk-links.ts`, modified `src/lib/warranty/*`.

### Automated
- [ ] `npm run test:warranty` passes (clock, transitions, outputs, zendesk-format).

### Manual
- [ ] From a warranty claim, **link a Zendesk ticket** (`POST …/zendesk/link`); candidate suggestions appear and resolve correctly.
- [ ] WarrantyTicketButton popover shows the linked thread (read-time sync).

**Findings:** _______________________________________________

---

## 11 · Billing + Stripe catalog seed

**What changed:** checkout/portal route tweaks (likely org-scoping) + a catalog seed script.
**Files:** `src/app/api/billing/{checkout,portal}/route.ts`, `scripts/stripe/seed-catalog.mjs`.

### Manual (Stripe **test mode** only)
- [ ] `node scripts/stripe/seed-catalog.mjs` creates the subscription products/prices in **test** mode (review before any live run).
- [ ] After seeding + wiring `STRIPE_PRICE_*`, `/api/billing/checkout` returns a session URL (no `PRICE_NOT_CONFIGURED`).
- [ ] `/api/billing/portal` mints a portal URL for an org with a Stripe customer.
- [ ] ⚠️ Do **not** run the seed against the live Stripe account during testing.

**Findings:** _______________________________________________

---

## 12 · Smaller surfaces & shared UI

- [ ] **Product models lookup** — `GET /api/product-models/lookup` returns expected matches.
- [ ] **Auth session route** — `src/app/api/auth/session/route.ts` diff reviewed; session info endpoint still returns correct org/staff.
- [ ] **Orders-exceptions sync** + **Ecwid sync-exception-tracking** routes still reconcile correctly.
- [ ] **Shared UI** — `OrderIdentityChips`, `DateGroupHeader`, `OutboundStatePill` render in their host views with no layout regression.
- [ ] **Sidebar navigation** — `tsx --test src/lib/sidebar-navigation.test.ts` passes; nav renders.
- [ ] **Barcode routing** — `tsx --test src/lib/barcode-routing.test.ts` passes (legacy QR rewrites in `proxy.ts`).
- [ ] **Admin page** — `src/app/admin/page.tsx` tabs all load.
- [ ] **Settings sections** (10 modified) — each settings section renders and saves.

**Findings:** _______________________________________________

---

## 13 · Hygiene (clean before commit)

- [ ] `.playwright-mcp/` console + page logs (40+ files) are **gitignored or deleted** — these are test artifacts, not source. Confirm they won't be committed.
- [ ] `vision/some_test.jpg` and other scratch artifacts reviewed — keep or remove intentionally.
- [ ] `scripts/_*.{ts,mjs}` underscore-prefixed verify scripts — decide keep vs remove (author scratch tools).
- [ ] `.DS_Store` not committed.
- [ ] New docs under `docs/` (tenancy, operations-studio, plans) are intended to ship.
- [ ] `docs/security/route-permissions.json` regenerated diff matches the new routes (run `npm run audit-route-auth:emit` and confirm).

**Findings:** _______________________________________________

---

## 14 · Sign-off gate (all must be checked to commit)

- [ ] §0 pre-flight fully green (build + tsc + lint + migrate + audits).
- [ ] §1 multi-tenancy isolation **proven** (automated suite + manual two-org spot check).
- [ ] Every new feature §2–§11 manually exercised at least once on a seeded test org.
- [ ] No `[!]` FAIL boxes remain open (or each is logged as a known-issue with an owner).
- [ ] §13 hygiene done — no test artifacts / `.DS_Store` / scratch files in the commit.
- [ ] Run the diff once more (`git diff --stat`) and confirm nothing unexpected.

**Overall verdict:** ☐ Ship  ☐ Hold — _______________________________________________

---

### Appendix — quick command block

```bash
# Pre-flight
npm ci && npx tsc --noEmit && npm run lint && npm run build
npm run db:migrate:dry && npm run db:migrate
npm run audit-route-auth:check && npm run audit-permissions
npm run tenancy:audit && npm run tenancy:guard:check

# Targeted test suites
npm run test:auth
npm run test:workflow
npm run test:warranty
npm run test:shipping-status
npm run test:zoho-fulfillment
tsx --test src/lib/tenancy/cross-org-isolation.test.ts
tsx --test src/lib/studio/*.test.ts
tsx --test src/lib/testing/resolve-testing-scan.test.ts

# E2E
npm run test:e2e:realtime-token
npm run test:e2e:workflow-tap
playwright test tests/e2e/receiving-tech-modes.spec.ts
playwright test tests/e2e/visual-identify-endpoints.spec.ts
```
