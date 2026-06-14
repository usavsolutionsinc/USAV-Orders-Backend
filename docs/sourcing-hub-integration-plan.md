# Sourcing Hub — Universal Demand → Scour → Acquire Plan

**Status:** Proposed · **Created:** 2026-06-13 · **Supersedes scope of:**
`docs/bose-parts-sourcing-engine-plan.md` (kept as the origin/backend runbook).

This plan turns the existing **Bose-parts** sourcing engine into a **universal sourcing &
procurement hub**: every system that produces a "we need to buy/find this" signal feeds one
prioritized demand queue, and that queue *directs* multi-source scouring (eBay today,
pluggable adapters next) into reviewable candidates that import into the existing
receiving/inventory pipeline with cost + margin tracking.

---

## 1. Where we are (honest current state)

The `/sourcing` page exists and the **backend is fully built** — it just outgrew its Bose
framing without the UI catching up.

**Built & live:**
- Page `src/app/sourcing/page.tsx` (RouteShell), sidebar `SourcingSidebarPanel.tsx`, right
  pane `SourcingWorkspace.tsx`. Three modes via `?mode=`: **Lookup / Alerts / Watchlist**.
- Tables: `sourcing_alerts`, `sourcing_candidates`, `part_acquisitions`, `bose_models`,
  `bose_serial_prefixes`, `part_compatibility`, `suppliers`; `sku_catalog` carries
  `lifecycle_status`, `reorder_threshold`, `last_known_cost_cents`, `replenish_target_cents`,
  `sourcing_notes`.
- API: `/api/sourcing/{search,alerts,candidates,candidates/[id],candidates/[id]/import}`,
  `/api/bose-models{,/[id],/lookup}`, `/api/part-compatibility{,/[id]}`, `/api/suppliers{,/[id]}`.
- Jobs/cron: `runSourcingScanJob` (`/api/cron/sourcing/scan`, nightly) opens
  eol/discontinued/low_stock/demand_no_stock alerts; `runReplenishmentWatch`
  (`/api/cron/sourcing/replenish`) prices `replenish` alerts against `replenish_target_cents`.
- Auto-enroll: `trg_replenish_on_sold` (migration `2026-06-06j_sku_replenish.sql`) opens a
  live `replenish` alert when any SKU ships, exception-guarded so it can't fail a shipment.
- eBay Browse app-token client `src/lib/ebay/browse-client.ts` + `sourcing/{search,normalize}`.
- Full RBAC (`sourcing.view|manage|search|import`, `supplier.view|manage`) + audit vocab.

**The gaps this plan closes:**
1. **It's framed as Bose-only.** Lookup, compatibility, and the IA all assume Bose models,
   even though the alert/candidate/acquisition spine is brand-agnostic. "Different products"
   has no home.
2. **Demand is fragmented.** Sourcing only ingests its own scan + the replenish trigger. The
   *other* real demand signals — missing parts on orders, open repair/warranty part needs,
   order exceptions, pending SKUs, FBA replenishment — never reach the sourcing queue, so
   scouring isn't actually *directed* by what the shop needs.
3. **One channel, manual fan-out.** Search is a single eBay Browse round-trip triggered per
   part row. There's no source-adapter abstraction, no standing/saved searches, no
   cross-channel comparison, no scheduled scouring per demand item.
4. **No hub IA.** There's no demand inbox, no supplier surface, no margin/analytics, and no
   Ops Studio / workflow / station integration even though the registries are ready.

---

## 2. The model (one spine, four stages)

Generalize everything around a brand-agnostic pipeline. Bose becomes *one* compatibility
provider, not the schema.

```
        ┌─────────────┐   ┌──────────────┐   ┌───────────────┐   ┌──────────────┐
DEMAND →│  Sourcing   │ → │   Scour /    │ → │   Candidates  │ → │   Acquire    │
 (many) │   Queue     │   │   Search     │   │  (watchlist)  │   │  (import →   │
        │ (alerts ++) │   │ (adapters)   │   │  multi-source │   │  receiving)  │
        └─────────────┘   └──────────────┘   └───────────────┘   └──────────────┘
            §3                  §4                  §5                   §6
```

- **DEMAND** — a unified queue of "needs". `sourcing_alerts` is already the queue table; we
  widen `alert_type` and add a few demand-source columns instead of inventing a new table.
- **SCOUR** — a `SourceAdapter` interface (eBay = first impl) so "search" means "search the
  N enabled channels", with standing searches the cron can re-run per demand item.
- **CANDIDATES** — `sourcing_candidates` already supports any `source`; widen the source
  enum and add channel metadata so candidates from different channels compare side-by-side.
- **ACQUIRE** — `importCandidate` already lands a `receiving` row + `part_acquisitions` +
  rolls `last_known_cost_cents`. Keep it; generalize `source_platform` resolution.

---

## 3. Directing the scour — unify demand signals (the core ask)

**Goal:** every signal below becomes a row in the sourcing queue with a SKU (or a pending
SKU / free-text target), a reason, a severity, and a *demand origin* so we know why we're
looking and can route it to the right scour strategy.

### 3.1 Schema — widen the queue, don't fork it
New migration (additive):
```sql
ALTER TABLE sourcing_alerts
  ADD COLUMN demand_source  text NOT NULL DEFAULT 'scan',   -- scan|replenish|missing_part|repair|warranty|order_exception|pending_sku|fba|manual
  ADD COLUMN demand_ref_type text,                          -- order|repair|warranty_claim|fba_shipment|pending_sku|...
  ADD COLUMN demand_ref_id  integer,                        -- the originating row id (for back-links)
  ADD COLUMN target_qty     integer,                        -- how many we need (default 1)
  ADD COLUMN search_query   text;                           -- free-text scour query when no SKU/model resolves
-- widen the type check to add the new auto types:
--   reorder|backorder|repair_part|warranty_part|fba_replenish  (keep existing 5)
```
Keep the partial unique index `uniq_sourcing_alert_live (sku_id, alert_type)`; for
demand-origin rows that have no SKU yet, add a second partial unique on
`(demand_ref_type, demand_ref_id, alert_type)` so re-runs stay idempotent.

> A SKU is no longer required — a queue row can carry only `search_query` (e.g. "Sony
> WH-1000XM4 left earcup") so genuinely *new* products can be scoured before they're catalog
> SKUs. This is what makes it "different products," not just Bose parts.

### 3.2 Demand collectors (each is a small, idempotent upsert into `sourcing_alerts`)
Add `src/lib/sourcing/demand-collectors.ts` with one function per source, all run from the
nightly scan (extend `runSourcingScanJob`) and individually callable from their domain
mutation for near-real-time enrollment:

| Demand source | Trigger / read | Existing surface | New alert |
|---|---|---|---|
| Low stock / reorder | `bin_contents` sum ≤ `reorder_threshold` | already in scan | `reorder` (rename of low_stock) |
| EOL / discontinued | `lifecycle_status` + on-hand | already in scan | `eol`/`discontinued` |
| Replenish-on-sold | `trg_replenish_on_sold` | already live | `replenish` |
| **Missing parts** | order flagged missing | `/api/orders/missing-parts`, `missing_parts_note`/`parts_status` | `missing_part` (demand_ref=order) |
| **Repair parts** | open `repair_service`/`unit_repairs` needing a part | `src/lib/neon/repair-service-queries.ts`, `failure_modes` | `repair_part` (demand_ref=repair) |
| **Warranty parts** | open `warranty_claims` in repair status | `src/lib/warranty/claims.ts` | `warranty_part` (demand_ref=claim) |
| **Order exceptions** | unmatched/unfulfillable | `orders_exceptions` + `/api/orders-exceptions` | `backorder` (demand_ref=order) |
| **Pending SKUs** | unknown SKU seen N times | `pending_skus.occurrences` | `pending_sku` (search_query from normalized_sku) |
| **FBA replenishment** | inbound plan shortfall | `src/lib/fba/**`, `fba_plan_items` | `fba_replenish` |
| Manual | user "Source this" button anywhere | new | `manual` |

Each collector is exception-guarded (mirror `fn_replenish_on_sold`) so a domain failure
never blocks the originating flow. The scan stays one transaction, single round-trips, no
N+1 (neon-cost-reviewer gate).

### 3.3 "Source this" everywhere
A reusable `SourceThisButton` (calls `POST /api/sourcing/alerts` with `demand_source:'manual'`)
dropped onto: a SKU/product row, a repair detail, a warranty claim, an order line, a pending
SKU. This is how a human *directs* a scour for any product on demand — the inverse of waiting
for the nightly scan.

---

## 4. The scour engine — multi-source, directed, schedulable

### 4.1 Source-adapter abstraction
Refactor `src/lib/sourcing/search.ts` so eBay is one adapter behind an interface:
```ts
// src/lib/sourcing/adapters/types.ts
export interface SourceAdapter {
  id: 'ebay' | 'amazon' | 'google_shopping' | 'zoho_po' | 'distributor' | 'manual';
  label: string;
  enabled(orgId: OrgId): Promise<boolean>;          // creds present?
  search(req: ScourRequest): Promise<NormalizedCandidate[]>;
  quota?: { perDay: number; logTable: string };     // e.g. ebay_api_calls
}
```
- `adapters/ebay.ts` — wraps the current `browseSearch` + `normalizeBrowseItems` verbatim.
- `searchSecondaryMarket()` becomes `scour(req)` → fan **in** across `enabledAdapters`,
  dedupe, tag each candidate with its `source`, persist when `save`. Quota discipline
  preserved (user-initiated; standing searches are throttled by the scheduler in §4.3).

**Candidate channel widening:** `sourcing_candidates.source` enum grows
(`ebay|manual` → `+amazon|google_shopping|zoho_po|distributor`); `normalize.ts` gains a
per-adapter mapper. UI already renders `source` generically.

### 4.2 The query builder is *demand-directed*
Today the query is `modelNumber + partRole + query`. Generalize
`src/lib/sourcing/query-builder.ts` to assemble the best query from whatever the demand row
carries, in priority order:
1. explicit `search_query` (manual / pending-sku),
2. compatibility model number + part role (Bose today, generic `product_models` later — §5),
3. `sku_catalog.product_title` (the **items** title SoT — see memory: prefer `items.name`),
4. brand + MPN/GTIN if present.
Plus demand-aware **condition presets**: a `for_parts` repair demand defaults conditions to
`used|for_parts`; a resale-grade reorder defaults to `new|refurbished`; price ceiling seeded
from `replenish_target_cents` or `last_known_cost_cents`.

### 4.3 Standing searches + scheduled scouring
- New `sourcing_searches` table: `{ id, sku_id?, demand_alert_id?, query, adapters[],
  conditions[], max_price_cents, cadence (off|daily|weekly), last_run_at, is_active, org }`.
- Extend the replenish watcher into a general **scour watcher** (`runScourWatch`) that runs
  due standing searches (replenish targets are just one kind), saves below-threshold hits,
  escalates the linked alert, and (optional) pings the owner. One adapter call per due row
  per run — same quota posture as today.
- Saving a search from the UI = "watch this product"; the queue row and the standing search
  stay linked so resolving the demand deactivates the watch.

### 4.4 Vision-directed scour (stretch)
`src/lib/vision-identify.ts` (DINOv2 box) already maps an image → `[{sku,score}]`. Add: paste
a listing/product photo → identify SKU → pre-fill the scour query and auto-link the candidate
to that SKU. Lets us scour "this thing in my hand" without knowing the model.

---

## 5. Compatibility / catalog — de-Bose the lookup

`bose_models` + `part_compatibility` are good tables with a brand baked into the name. Two
options (pick in §11):
- **A (recommended, low-risk):** keep the tables, add a thin generic façade. Introduce
  `product_models` as a **view/alias** concept in the API layer (`/api/product-models`,
  `/api/fitment`) that currently reads `bose_models`/`part_compatibility` but is the seam we
  grow. The Lookup UI stops saying "Bose" and resolves *any* model that's been cataloged.
- **B (later):** generalize the schema to `product_models (brand, model_number, family,
  product_type, …)` + `fitment` and migrate Bose rows in. Bigger migration; defer until a
  second brand actually needs it.

Either way the **Lookup mode** becomes: search a model (or scan a serial) → compatible parts
with live stock + lifecycle + open-alert badges + **Scour** (multi-source) per part. This is
unchanged UX, just brand-neutral copy and a generic endpoint name.

---

## 6. Acquire — keep the spine, generalize the edges

`importCandidate` already: upserts supplier from seller → creates `receiving`
(`source='sourcing_import'`, `source_platform='ebay'`) → `part_acquisitions(status='ordered')`
→ rolls `last_known_cost_cents` → drops into the normal unbox flow. Changes:
- `source_platform` derives from the candidate's adapter `source` (not hardcoded `'ebay'`),
  using `src/lib/source-platform.ts` (already has ebay/amazon/walmart/aliexpress/etc.). When
  the platform/account/type catalog lands (`docs/platform-account-type-catalog-plan.md`),
  resolve through it instead — additive, no break.
- On unbox, stamp `part_acquisitions.serial_unit_id` + condition (the receiving pipeline
  already creates the unit) to close the cost→resale margin loop.

---

## 7. UI — the hub IA (sidebar-mode architecture)

Per the **sidebar-mode** skill: every surface is a `?mode=` MODE via `HorizontalButtonSlider`
+ `SidebarShell`; search lives in the sidebar; right pane is visual display. Grow the three
modes to a real hub:

| Mode | Sidebar (search/filter) | Right pane | Status |
|---|---|---|---|
| **Queue** *(new, default)* | demand-source filter + severity + search | unified prioritized demand list (alerts ++), each row → inline Scour + back-link to origin (order/repair/claim) | NEW |
| **Scout** *(was Lookup)* | model/serial/free-text + adapter + condition + price | resolved target → compatible parts (if any) → multi-source candidate results, Save/Import | EVOLVE |
| **Watchlist** | status filter | saved candidates across channels, compare price/condition/seller, Import/Reject | EXISTS |
| **Searches** *(new)* | — | standing searches (cadence, last run, hits), pause/run-now | NEW |
| **Suppliers** *(new)* | search + type/rating | supplier cards: candidates, acquisitions, cost history, lead time | NEW (table+API exist) |
| **Analytics** *(new, later)* | date range | spend, acquisition cost vs resale margin, fill-rate, time-to-source | NEW |

Master-nav already owns the mode rail when enabled. Reuse `RowMetaColumns`, `StatusChip`,
condition/severity chip tones (already in `sourcing-shared.ts`), `Button`. Replace the
`window.prompt`/`window.alert` interactions (target price, resolve reason, import note) with
proper sheets/inputs (current code uses raw prompts — fine for v0, not for the hub).

**Admin editors** (existing plan §8.2): model catalog, compatibility, suppliers via
`AdminSidebarShell` + CSV import — still wanted; they feed Scout/Compatibility.

---

## 8. Ops Studio / workflow / station integration (registries are ready)

- **Station data-source:** register `sourcing.open_demand` in
  `src/lib/stations/data-sources.ts` (pattern: `registerDataSource`, `endpoint:
  '/api/sourcing/alerts'`, map rows → table columns). A checklist/station block can then bind
  to the sourcing queue with zero new UI — a "Sourcing" station for a buyer.
- **Station action:** add a "Scour for this SKU" action in `src/lib/stations/actions.ts`
  wrapping `POST /api/sourcing/search`, usable inline from any station row.
- **Workflow node:** add `src/lib/workflow/nodes/sourcing.node.ts` (thin adapter over
  `src/lib/sourcing/*`, mirroring `list-ebay.node.ts`/`repair.node.ts`). A unit that fails
  inspection for a missing part routes → `sourcing` node (opens demand / scours) → parks until
  a candidate imports → resumes repair. This is the graph realization of §3's repair-part
  demand. Follow the **workflow-node** skill (thin adapter contract over `src/lib/*`).

---

## 9. Permissions, audit, tenancy

- Permissions exist (`sourcing.*`, `supplier.*`). Add `sourcing.searches.manage` for standing
  searches if we want it gated separately (else fold into `sourcing.manage`). Any new
  permission ⇒ paired `route-permission-manifest.test.ts` edit + `audit-route-auth` green
  (permission-registry-guard).
- Audit: add entities/actions for `sourcing_search` and the new demand origins; keep
  `sourcing.candidate.import` + `sourcing.alert.resolve` reason-required.
- Tenancy: the sourcing tables stay un-scoped to match the `sku_catalog` hub (settled in the
  origin plan); per-org boundary remains **eBay/adapter credentials** resolved at request time
  via `getIntegrationCredentials`. New adapters resolve their creds the same way.
- Every new route satisfies the **api-route-reviewer** four (guard, Zod, idempotency on
  mutations, audit) and **neon-cost-reviewer** (single round-trips, no tight polling; standing
  searches throttled by cadence).

---

## 10. Phasing (each step independently shippable + verifiable)

- **Phase 0 — Hub IA & rename.** De-Bose copy; add **Queue** mode (renders existing alerts);
  promote it to default; split prompts into proper inputs. *No schema.* Gate: tsc + build.
- **Phase 1 — Unify demand.** Migration §3.1 (widen `sourcing_alerts`); demand collectors
  §3.2 for missing-parts, repair, warranty, pending-sku, order-exception, FBA; `SourceThisButton`.
  Gate: scan re-run idempotent; each collector exception-guarded.
- **Phase 2 — De-Bose lookup.** Generic `/api/product-models` + `/api/fitment` façade (Option
  A); Scout mode resolves any cataloged model; free-text scour for un-cataloged products.
- **Phase 3 — Adapter abstraction.** `SourceAdapter` interface; eBay adapter extracted;
  `scour()` fan-in + dedupe; candidate `source` widened. (Still eBay-only enabled.)
- **Phase 4 — Standing searches + scour watcher.** `sourcing_searches` table; **Searches**
  mode; generalize replenish cron → scour watcher.
- **Phase 5 — Suppliers + margin.** **Suppliers** mode (table/API exist); stamp
  `serial_unit_id` on unbox; **Analytics** (acquisition cost vs resale).
- **Phase 6 — New channels & Studio.** Second adapter (Amazon/Google Shopping or Zoho-PO cost
  history); station data-source/action + `sourcing.node`; vision-directed scour (stretch).

---

## 11. Open decisions (resolve before/early in build)

- **D1 — Lookup generalization:** Option A façade now vs Option B schema migration later.
  *Recommendation: A.*
- **D2 — Scope of "all products":** generalize fully (free-text + any-brand fitment) vs keep a
  Bose-first compatibility DB and only generalize *demand + scour*. *Recommendation: generalize
  demand+scour fully (Phase 1–4); keep compatibility Bose-first until a 2nd brand needs it.*
- **D3 — Second channel priority:** Amazon SP-API (buy side, needs Nango/creds) vs Google
  Shopping (broad, simple) vs Zoho-PO history (no new API, internal cost intelligence).
  *Recommendation: Zoho-PO cost adapter first (free, internal), then Google Shopping.*
- **D4 — Human-in-the-loop only:** keep "we capture + import, humans buy" (no auto-checkout) —
  *yes, unchanged from origin plan §11.*
- **D5 — Real-time vs nightly demand:** collectors run nightly + on-domain-mutation, or
  nightly only. *Recommendation: nightly now, add inline calls opportunistically.*

## 12. Out of scope (v1)
Auto-purchasing/checkout, predictive demand forecasting, automated price negotiation,
cross-org supplier sharing.
