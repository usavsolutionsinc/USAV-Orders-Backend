# Warranty Claim Logger + Repair Outcome Tracker — Implementation Plan

_Status: plan-only (2026-06-06). Lives on the **Orders / Shipping** page (`/dashboard`,
routeKey `dashboard`) as a new sidebar **MODE**, per the `sidebar-mode` contract._

## 0. Goal & scope

Add a **Warranty Logger** surface to the Orders / Shipping page that lets staff:

- Log a warranty claim against a **serial** (auto-resolving its order, SKU, customer,
  purchase proof, delivered/packed dates).
- Track claim status + **denial reasons**.
- Record **repair attempts / outcomes** with **photo + parts-used attachments**.
- Fire **auto-notifications** to the tenant org and/or end customer on status changes.
- **Export reports** for supplier-escalation and for eBay "repaired unit" relisting.
- Run a **post-warranty paid-repair quoting** workflow.

The warranty **clock** is the new domain rule (see §4): warranty expires **30 days after
the carrier `DELIVERED` date**, or — when no delivered status exists — **30 days after
the packed/scanned date + 4 days** (i.e. packed + 34 days).

### Mode order on the page
The mode rail becomes: **Awaiting · Pending · Shipped · Warranty Logger** (the user-
requested order; today the rail is Pending / Shipped / Awaiting, so the items are also
reordered).

---

## 1. How this maps to what already exists (reuse inventory)

| Need | Already in repo | Reuse decision |
|---|---|---|
| Page mode system | `?pending`/`?shipped`/`?unshipped`/`?fba` bare-presence params → `DashboardOrderView` (`src/utils/dashboard-search-state.ts`); mode rail in `SIDEBAR_PAGE_NAV` (`src/lib/sidebar-navigation.ts`); dispatch in `DashboardSidebar.tsx` `routeKey === 'dashboard'`; right pane switch in `src/app/dashboard/page.tsx` | Add a 4th view `warranty`; no new router |
| Sidebar shell / search | `SidebarShell` (`search`/`filter`/`headerRows`), `HorizontalButtonSlider` | New `WarrantyLoggerSidebar` returns a `SidebarShell` |
| RMA / returns | First-class `rma_authorizations` + `return_dispositions` (migration 2026-05-23), domain `src/lib/rma/authorizations.ts`, routes `/api/rma/*`, flag `INVENTORY_V2_RMA`, statuses AUTHORIZED→RECEIVED→DISPOSITIONED→CLOSED | **Warranty claim links to an RMA** when physical return is needed; we do NOT duplicate RMA. Warranty is the customer-facing claim record; RMA is the inbound carton. |
| Repair | `repair_service` table, `work_assignments.repairOutcome`, status enum `IN_REPAIR`/`REPAIR_DONE`, repair page + `RepairSidebarPanel` | Repair attempts on a warranty claim reuse `repair_service` linkage (FK), not a parallel repair model |
| Serials | `serial_units` master + `src/lib/neon/serial-units-queries.ts` (`resolvePriorOutbound`) | Resolve order/SKU/outbound history from a scanned serial |
| Carrier delivered date | `shipping_tracking_numbers` (FK `orders.shipment_id`; `delivered` bool + `delivered_at`); adaptive cron tracking sweep (tracking-live-sync) | Source the `DELIVERED` timestamp for the warranty clock |
| Packed/scanned date | `orders.packed_at`, `packer_logs`, `scans.packed_by` | Fallback clock anchor |
| Multi-tenant | `organizationId` / `orgIdCol()` on tables (e.g. `customers`) | Stamp `organization_id` on every new table; no new tenancy mechanism |
| Customer contact | `customers` (email/phone/displayName, `channel_refs`) | Notification recipient resolution |
| Photos / attachments | NAS direct-write WebDAV (Vercel Blob removed), `photos` table, `/api/nas-config`, `NasReceivingAttach.tsx`, `ReceivingPhotoStrip.tsx` | Reuse NAS PUT path for claim/repair photos |
| Auth + audit | `withAuth(handler, { permission })`, `permission-registry.ts` (+ guarded `route-permission-manifest.test.ts`), `src/lib/audit-logs.ts` | All new routes guarded + audited + idempotent on mutations |
| eBay export | `mcp__ebay__*` tools + internal eBay listing/import code, `secondary_market_listings` table | Generate a "refurbished unit" draft listing payload from a repaired claim |

---

## 2. Data model (new tables in `src/lib/drizzle/schema.ts` + migration)

All tables get `organization_id` via `orgIdCol()`, `created_at`/`updated_at`, and
`created_by_staff_id`. Mirror the existing snake_case column + helper conventions.

### 2.1 `warranty_claims`
The central record — one per claim.

- `id` identity PK
- `organization_id`
- `claim_number` text unique — `WC-YYYY-NNNNN`, generated server-side (copy the
  per-year counter pattern from `nextRmaNumber()` in `src/lib/rma/authorizations.ts`)
- `serial_unit_id` int FK → `serial_units` (nullable; claims can predate a known unit)
- `serial_number` text (denormalized snapshot, like `repair_service`)
- `order_id` text / int — resolved source order
- `sku` text, `product_title` text
- `customer_id` int FK → `customers`
- `source_system` text (`ebay` | `zoho` | `manual` | …), `source_order_id`,
  `source_tracking_number`
- **Purchase proof**: `purchase_proof_url` text + `purchase_proof_attachment_id` (NAS),
  `purchased_at` timestamp
- **Warranty clock (see §4)**: `delivered_at` timestamptz (nullable),
  `packed_scanned_at` timestamptz (nullable), `warranty_starts_at` timestamptz,
  `warranty_expires_at` timestamptz, `clock_basis` text enum
  (`DELIVERED` | `PACKED_PLUS_ESTIMATE`)
- `status` text — lifecycle enum (see §3): `LOGGED` | `SUBMITTED` | `APPROVED` |
  `DENIED` | `IN_REPAIR` | `REPAIRED` | `CLOSED` | `EXPIRED`
- `denial_reason_code` text (nullable) + `denial_notes`
- `rma_id` int FK → `rma_authorizations` (nullable; set when a physical return is issued)
- `repair_service_id` int FK → `repair_service` (nullable; set on repair handoff)
- `notes` text

### 2.2 `warranty_claim_events`
Append-only status/audit timeline (mirrors `repair_service.status_history` jsonb idea but
as rows so it is queryable & per-tenant).

- `id`, `organization_id`, `claim_id` FK, `event_type` (`STATUS_CHANGE` | `NOTE` |
  `NOTIFICATION_SENT` | `ATTACHMENT_ADDED` | `REPAIR_LOGGED`), `from_status`, `to_status`,
  `payload` jsonb, `actor_staff_id`, `created_at`

### 2.3 `warranty_repair_attempts`
One row per repair attempt/outcome (richer than the single `repairOutcome` text field).

- `id`, `organization_id`, `claim_id` FK
- `attempt_no` int, `technician_staff_id`
- `diagnosis` text, `parts_used` jsonb (`[{sku, qty, cost}]`),
  `outcome` text enum (`FIXED` | `NOT_FIXABLE` | `PENDING_PARTS` | `RTV`)
- `labor_minutes` int, `cost_parts` numeric, `cost_labor` numeric
- `photo_attachment_ids` jsonb (NAS photo refs), `notes`
- `started_at`, `completed_at`

### 2.4 `warranty_quotes` (post-warranty paid-repair)
- `id`, `organization_id`, `claim_id` FK, `quote_number` (`WQ-YYYY-NNNNN`)
- `line_items` jsonb (`[{label, qty, unitPrice}]`), `subtotal`, `tax`, `total`
- `status` (`DRAFT` | `SENT` | `ACCEPTED` | `DECLINED` | `EXPIRED`)
- `sent_at`, `responded_at`, `valid_until`

> Migration file: `migrations/2026-06-XX_warranty_claim_logger.sql` (raw SQL like the
> existing 2026-05-23 RMA migration), plus matching Drizzle table defs + `$inferSelect`
> /`$inferInsert` type exports. Add a CHECK constraint for each status enum (so a bad
> status is a 400 not a 500, per the `reason-codes` precedent).

### 2.5 Denial-reason catalog
Reuse the **`reason_codes`** pattern (`src/lib/schemas/reason-codes.ts`): either add a
`warranty_denial` category to `reason_codes`, or seed a small `warranty_denial_reasons`
lookup. Decision lean: **add a `direction='out'` category to `reason_codes`** to avoid a
new table — denial reasons are config-managed exactly like reason codes.

---

## 3. Status lifecycle

```
LOGGED ─submit→ SUBMITTED ─┬─approve→ APPROVED ─repair→ IN_REPAIR ─done→ REPAIRED ─→ CLOSED
                           └─deny───→ DENIED ─(optional paid-repair quote)→ CLOSED
any active state ─clock elapsed→ EXPIRED   (cron, see §4.3)
```

Transitions move through dedicated verb routes (the RMA pattern: status is **not** a
free PATCH field). Every transition writes a `warranty_claim_events` row + an audit-log
entry, and may enqueue a notification (§6).

---

## 4. Warranty clock (the new domain rule)

Single source of truth: `src/lib/warranty/clock.ts` (pure, unit-tested).

```
WARRANTY_DAYS = 30
DELIVERY_ESTIMATE_DAYS = 4   // used only when no carrier DELIVERED status

function computeWarranty({ deliveredAt, packedScannedAt }):
  if deliveredAt:
    start = deliveredAt
    basis = 'DELIVERED'
  else if packedScannedAt:
    start = packedScannedAt + DELIVERY_ESTIMATE_DAYS days
    basis = 'PACKED_PLUS_ESTIMATE'
  else:
    return { start: null, expires: null, basis: null }   // unknown — flag in UI
  expires = start + WARRANTY_DAYS days
  return { start, expires, basis }
```

### 4.1 Sourcing the inputs
- `deliveredAt`: join `orders.shipment_id → shipping_tracking_numbers.delivered_at`
  (only when `delivered = true`). This is kept fresh by the existing adaptive cron
  tracking sweep (tracking-live-sync), so no new polling is added.
- `packedScannedAt`: `orders.packed_at` (fallback: latest `packer_logs` / `scans.packed_by`
  timestamp for the order).

### 4.2 When it's computed
- On claim creation (stamped onto the row).
- **Re-derived** by the same cron that updates tracking: when a previously-undelivered
  order flips to `DELIVERED`, recompute the claim's `warranty_*` columns and switch
  `clock_basis` from `PACKED_PLUS_ESTIMATE` → `DELIVERED`. This is the "update via …"
  half of the requirement — the estimate is provisional until a real delivered date
  lands. Guard the recompute behind Neon-cost review (batch in the existing sweep, don't
  add a new interval).

### 4.3 Expiry
- A daily cron (`/api/cron/warranty-expiry`, registered in `vercel.ts` crons or the
  existing cron registry) moves active claims past `warranty_expires_at` to `EXPIRED`
  and can auto-offer a paid-repair quote (§7).

### 4.4 UI surfacing
- Each claim row shows a countdown chip: days-to-expiry, plus a basis badge
  (`Delivered` solid vs `Est.` dashed) so staff see when the date is still provisional.
  Reuse the receiving display primitives (slim color-coded chips / tone maps) rather than
  inlining colors.

---

## 5. API routes (`src/app/api/warranty/...`)

All `withAuth(..., { permission })`, Zod-validated bodies in `src/lib/schemas/warranty.ts`,
idempotency key on every mutation, audit-log on every write. Register each new permission
in `permission-registry.ts` **and** update `route-permission-manifest.test.ts` in the same
commit (the `permission-registry-guard` enforces this; run `scripts/audit-route-auth.ts`).

| Route | Method | Permission | Purpose |
|---|---|---|---|
| `/api/warranty/claims` | GET | `warranty.view` | list (filter by status/serial/customer/expiring) |
| `/api/warranty/claims` | POST | `warranty.manage` | create claim (resolves serial→order→clock) |
| `/api/warranty/claims/[id]` | GET/PATCH | `warranty.view`/`warranty.manage` | read / edit metadata (not status) |
| `/api/warranty/claims/[id]/submit` | POST | `warranty.manage` | LOGGED→SUBMITTED |
| `/api/warranty/claims/[id]/approve` | POST | `warranty.manage` | →APPROVED |
| `/api/warranty/claims/[id]/deny` | POST | `warranty.manage` | →DENIED (reason required) |
| `/api/warranty/claims/[id]/repair` | POST | `warranty.repair` | log a `warranty_repair_attempts` row (photos/parts) |
| `/api/warranty/claims/[id]/close` | POST | `warranty.manage` | →CLOSED |
| `/api/warranty/claims/[id]/rma` | POST | `warranty.manage` | issue/link an RMA (calls `createAuthorization`) |
| `/api/warranty/claims/[id]/quote` | POST | `warranty.manage` | create paid-repair quote |
| `/api/warranty/claims/[id]/attachments` | POST | `warranty.manage` | register a NAS-stored photo/proof |
| `/api/warranty/reports/export` | GET | `warranty.view` | CSV/JSON for supplier escalation |
| `/api/warranty/claims/[id]/ebay-draft` | POST | `warranty.manage` | build refurb listing payload |
| `/api/cron/warranty-expiry` | POST | cron secret | sweep → EXPIRED + recompute clocks |

Gate the whole surface behind a feature flag `WARRANTY_LOGGER` (mirrors `INVENTORY_V2_RMA`)
so it ships dark.

Domain logic in `src/lib/warranty/` (`claims.ts`, `clock.ts`, `notifications.ts`,
`ebay-export.ts`) — routes stay thin, matching the `lib/rma/authorizations.ts` split.

---

## 6. Notifications (auto-notify tenants/customers)

- Resolve recipient from `customers` (email/phone) + org settings.
- **Email**: reuse whatever transactional email path the repo already has (search confirmed
  notification infra exists; wire into it rather than adding a provider). Channel selection
  per org via `organization` settings bag.
- **In-app / realtime**: the app already uses **Ably** inbox channels (`inbox:{staffId}`,
  e.g. priority_unbox); emit a staff inbox event on status change so the Orders page badge
  updates live.
- Notifications are **enqueued from the verb routes** and logged as
  `warranty_claim_events(event_type='NOTIFICATION_SENT')`. Customer emails are an
  outward-facing action → respect the "confirm before sending outward" rule: default to a
  **review-then-send** step in the UI, not silent auto-send, unless the org opts into auto.

---

## 7. Post-warranty paid-repair quoting

- When a claim is `DENIED` or `EXPIRED`, surface a "Quote paid repair" action.
- Build a `warranty_quotes` row from `warranty_repair_attempts` parts/labor estimates.
- Send to customer (review-then-send), track `ACCEPTED`/`DECLINED`.
- On `ACCEPTED`, hand off to `repair_service` (create/link a ticket) — closes the loop into
  the existing repair/tech module instead of a parallel workflow.

---

## 8. eBay "repaired unit" export

- On a `REPAIRED`/`CLOSED` claim, `/api/warranty/claims/[id]/ebay-draft` assembles a
  refurbished-listing payload (title, condition=refurbished, repair notes summary, photos
  from `warranty_repair_attempts`).
- Reuse the existing eBay integration (the `mcp__ebay__*` `create_offer`/`create_listing`
  path or the internal listing module) — produce a **draft** for human review, do not
  auto-publish (outward-facing).
- Optionally seed `secondary_market_listings` for the watchlist/import flow.

---

## 9. Reports (supplier escalation)

- `/api/warranty/reports/export` returns claims joined with denial reasons + repair
  outcomes + parts cost, filterable by SKU / supplier / date / outcome — the dataset for
  "document issues for supplier negotiations."
- Surfaced as a sidebar action button in the Warranty mode (CSV download), modeled on the
  existing `PickupReportButton` / `ZohoSyncButton` in `ShippedSidebar`.

---

## 10. Frontend — the sidebar MODE (sidebar-mode compliant)

### 10.1 Extend the view union + clock helpers
`src/utils/dashboard-search-state.ts`:
```ts
export type DashboardOrderView = 'pending' | 'unshipped' | 'shipped' | 'fba' | 'warranty';
// getDashboardOrderViewFromSearch: add `if (searchParams.has('warranty')) return 'warranty';`
// normalizeDashboardOrderViewParams: add 'warranty' to the delete()+set() list
```

### 10.2 Add the mode pill (reordered)
`src/lib/sidebar-navigation.ts` → the `dashboard` entry in `SIDEBAR_PAGE_NAV`. Reorder to
**Awaiting · Pending · Shipped · Warranty Logger** and add:
```ts
{ id: 'warranty', label: 'Warranty Logger', icon: ShieldCheck,
  to: () => ({ pathname: DASHBOARD, params: { warranty: '', pending: null, shipped: null, unshipped: null, fba: null } }) },
// resolveMode: add `if (params.has('warranty')) return 'warranty';`
```
(Master-nav L2 rail picks this up automatically; the legacy in-panel
`HorizontalButtonSlider` items must include it too for the master-nav-off path.)

### 10.3 Sidebar dispatch
`src/components/DashboardSidebar.tsx`, `routeKey === 'dashboard'` branch — add:
```tsx
if (dashboardSearch.orderView === 'warranty') {
  return <WarrantyLoggerSidebar embedded hideSectionHeader
            searchValue={dashboardSearch.searchQuery}
            onSearchChange={dashboardSearch.setSearch}
            filterControl={filterControl} />;
}
```
New `src/components/warranty/WarrantyLoggerSidebar.tsx` returns a `SidebarShell`:
- `search` = serial / claim# / order# / customer (placeholder per mode)
- `filter` = status, clock-basis, expiring-soon, denial-reason
- result list = claim rows with the countdown chip; selecting writes `?open=<claimId>`
- header action buttons: **+ New Claim**, **Export**

### 10.4 Right pane (visual only)
`src/app/dashboard/page.tsx` view switch — add a `warranty` arm rendering
`WarrantyClaimsTable` + `WarrantyClaimDetailPanel` (reads `?open=`), following the
`DashboardShippedTable` + `ShippedDetailsPanel` shape. No search/mode controls in the pane.
Prefetch via a new `warrantyClaimsQuery` in the dashboard query factory + warm in
`warmActiveView`.

### 10.5 Hooks / queries
- `src/lib/queries/` (or the dashboard query module): `warrantyClaimsQuery`,
  `warrantyClaimQuery(id)`.
- `src/hooks/useWarrantyClaims.ts`, `useWarrantyClaimMutations.ts` (submit/approve/deny/
  repair/close), with React Query invalidation wired into `src/lib/orders/invalidation.ts`.

---

## 11. Phasing

1. **Phase 0 — data + clock.** Migration, Drizzle defs, `lib/warranty/clock.ts` + unit
   tests (the 30-day / +4-day rules), feature flag `WARRANTY_LOGGER`.
2. **Phase 1 — read path + mode.** GET routes, `WarrantyLoggerSidebar` mode, right-pane
   table/detail, countdown chips. Ships dark behind the flag.
3. **Phase 2 — write path.** Create + lifecycle verb routes, permissions registered +
   manifest test, audit + idempotency, repair-attempt logging with NAS photos/parts.
4. **Phase 3 — clock automation.** Hook recompute into the tracking cron; expiry cron.
5. **Phase 4 — notifications.** Email + Ably inbox on transitions (review-then-send).
6. **Phase 5 — RMA + repair linkage.** Issue/link RMA; hand off to `repair_service`.
7. **Phase 6 — outputs.** Supplier report export; eBay refurb draft; paid-repair quoting.

---

## 12. Verification checklist

- `npm run lint`, `npx tsc --noEmit` (exhaustive `DashboardOrderView` switches).
- `src/components/ui/sidebar-search-bar.guard.test.ts` still passes (search stays
  shell-only).
- `scripts/audit-route-auth.ts` passes; `route-permission-manifest.test.ts` updated.
- `clock.ts` unit tests: delivered-present, delivered-absent (packed+4+30),
  both-absent (unknown), and the provisional→delivered recompute.
- Neon-cost review on the cron recompute (batch in existing sweep; no new interval).
- Manual: deep-link `?warranty` loads the mode; switching modes clears `q`/`filter`/`open`;
  refresh preserves the mode; right pane shows only the selected claim's detail.

---

## 13. Decisions (confirmed 2026-06-06)

1. **Warranty term**: **per-org**, default 30 days. Resolved from `organizations.settings`
   jsonb (`warrantyDays`, policed in `src/lib/tenancy/settings.ts`), default 30. The clock
   helper stays pure and takes `warrantyDays` as a param; the call site resolves it per org.
2. **Denial reasons**: **extend `reason_codes`** — add a `warranty_denial` category (no new
   table). Migration alters `reason_codes_category_chk`; `REASON_CODE_CATEGORIES` gains it.
3. **Customer email**: **none for now.** Notifications phase (Phase 4) is deferred; only the
   Ably staff-inbox event is in scope when we get there. No transactional email wiring.
4. **Multi-tenant**: **yes — `organization_id` is the tenancy axis.** Every new table uses
   the `orgIdCol()` idiom (UUID, `DEFAULT NULLIF(current_setting('app.current_org', true),
   '')::uuid`), matching the freshest migrations (workflow_graph_layer 2026-06-03).
5. **eBay**: **draft-only.** Refurb listings are generated as drafts for human review; never
   auto-published.

## 14. Build status

- **Phase 1 complete** (2026-06-06): P0 foundation (migration, Drizzle tables, clock +
  tests, flag, reason category) + P1 read path (read module, GET routes, sidebar mode,
  right pane, queries/hooks). Ships dark behind `WARRANTY_LOGGER`.

### Activation
1. Apply the migration: `npm run db:migrate:dry` then `npm run db:migrate`
   (picks up `src/lib/migrations/2026-06-06_warranty_claim_logger.sql`).
2. Set `WARRANTY_LOGGER=true` in the environment to reveal the mode + routes.
3. Optionally set per-org `warrantyDays` in `organizations.settings` (default 30).

### Files (Phase 1)
- Migration: `src/lib/migrations/2026-06-06_warranty_claim_logger.sql`
- Schema: `src/lib/drizzle/schema.ts` (warrantyClaims/Events/RepairAttempts/Quotes)
- Domain: `src/lib/warranty/{clock,clock.test,term,claims,client,types}.ts`
- Flag: `src/lib/feature-flags.ts` (`isWarrantyLogger`)
- Denial reasons: `src/lib/schemas/reason-codes.ts` (`warranty_denial`)
- Org term: `src/lib/tenancy/settings.ts` (`warrantyDays`)
- Routes: `src/app/api/warranty/claims/route.ts`, `.../[id]/route.ts`
- Permissions: `src/lib/auth/permission-registry.ts` (`warranty.view/manage/repair`)
- Mode wiring: `src/utils/dashboard-search-state.ts`, `src/lib/sidebar-navigation.ts`,
  `src/components/DashboardSidebar.tsx`, `src/hooks/useDashboardSearchController.ts`
- UI: `src/components/warranty/*`, `src/hooks/useWarrantyClaims.ts`,
  `src/lib/queries/dashboard-queries.ts` (`warrantyClaimsQuery`), `src/app/dashboard/page.tsx`

### Verification
tsc clean (warranty code) · clock 12/12 · auth registry+manifest 37/37 ·
audit-route-auth exit 0 (warranty routes gated) · dashboard-state 10/10 ·
sidebar-search-bar guard 3/3. (`npm run lint` is broken repo-wide — Next 16 removed
`next lint`; unrelated to this work.)

### Phase 2 complete (2026-06-07) — write path
- **Domain**: `src/lib/warranty/mutations.ts` (createClaim w/ order→clock resolution +
  WC-number + term snapshot, updateClaimMeta, submit/approve/deny/close, logRepairAttempt
  w/ auto-advance) + `transitions.ts` (pure state machine, unit-tested).
- **Routes** (all `withAuth` + Zod + idempotent via `Idempotency-Key`/body + `recordAudit`,
  flag-gated): `POST /claims`, `PATCH /claims/[id]`, `POST /claims/[id]/{submit,approve,deny,close,repair}`.
  `warranty.manage` for lifecycle, `warranty.repair` for repairs. Helper:
  `src/lib/warranty/route-helpers.ts` (idempotency + path id + flag guard).
- **UI**: sidebar **+ Log Claim** dialog (`WarrantyLogClaimDialog`), status-aware action
  footer in the detail panel (`WarrantyClaimActions`: submit / approve / deny-with-reason /
  log-repair / close), mutation hooks (`useWarrantyMutations`) with list+detail invalidation,
  denial-reason picker from `reason_codes?category=warranty_denial`.
- **Idempotency**: response-level via the house `withIdempotentResponse` /
  `api_idempotency_responses` table — a repeated key replays the original response.
- **State machine**: `LOGGED→SUBMITTED→APPROVED→IN_REPAIR→REPAIRED→CLOSED`, `SUBMITTED→DENIED→CLOSED`;
  guarded with `SELECT … FOR UPDATE`; repair logging auto-advances APPROVED→IN_REPAIR and
  (outcome FIXED) IN_REPAIR→REPAIRED.
- **Verify**: tsc 0 errors · `npm run test:warranty` 19/19 (clock + transitions) · auth 37/37 ·
  `audit-route-auth` exit 0, 0 ungated writes, all warranty writes gated.

### Phase 3 complete (2026-06-07) — clock automation
- **Sweep**: `src/lib/warranty/clock-sweep.ts` — `recomputeProvisionalClocks` (re-resolve
  delivered/packed from the order, recompute the window with the stored term, flip
  PACKED_PLUS_ESTIMATE→DELIVERED + emit a `CLOCK_RECOMPUTED` event) and `expireLapsedClaims`
  (LOGGED/SUBMITTED past expiry → EXPIRED + event). Pure decision helper `decideClockRecompute`
  in `clock.ts` is unit-tested.
- **Cron**: hooked `runWarrantyClockMaintenance()` into the existing hourly
  `/api/cron/shipping/reconcile-delivered` (runs right after carrier delivered-state is
  reconciled) — **no new interval / no new cron entry**, guarded + flag-gated so a warranty
  error never breaks the shipping pass.
- **Neon cost** (reviewed): each pass = 1 read + ≤2 **set-based** writes (bulk `UPDATE … FROM
  unnest(...)` + bulk event `INSERT`) — no per-claim connection/round-trip loop. Added
  covering partial index `idx_warranty_claims_recompute (updated_at) WHERE clock_basis IS
  DISTINCT FROM 'DELIVERED' AND status NOT IN (CLOSED,EXPIRED) AND order_id IS NOT NULL` so the
  candidate scan + ORDER BY needs no sort. `packer_logs(shipment_id)` already indexed.
  Batch limits: recompute 300 / expire 500 per hour.
- **Verify**: tsc 0 · `npm run test:warranty` 24/24 (clock incl. 5 recompute-decision +
  transitions) · audit-route-auth exit 0 (no new route).

### Phase 4 complete (2026-06-07) — staff-inbox notifications
- **Recipient**: the staff member who LOGGED the claim (`created_by_staff_id`), skipping the
  actor. Customer email stays out of scope (deferred) per the confirmed decisions.
- **Publisher**: `publishWarrantyClaimNotification` in `src/lib/realtime/publish.ts` pushes a
  `warranty_claim` event to `inbox:{staffId}` (same channel/token grant as `priority_unbox`).
- **Notifier**: `src/lib/warranty/notify.ts` — `notifyWarrantyTransition` (fired from the
  submit/approve/deny/close/repair routes after audit) + `notifyWarrantyExpired` (fired from
  the cron expiry sweep). Best-effort (never breaks the mutation); each send logs a
  `NOTIFICATION_SENT` row on the claim timeline.
- **Client**: `ActivityInboxContext` gains a `warranty_claim` kind + a second `useAblyChannel`
  subscription on the inbox channel; items render in the existing header Activity-inbox
  popover and deep-link to `/dashboard?warranty&open={claimId}`.
- **Detail**: `WarrantyClaimDetail` now exposes `createdByStaffId` (added to `getClaim`).
- **Verify**: tsc 0 · test:warranty 24/24 · auth 37/37 · audit exit 0, 0 ungated writes.

### Phase 5 complete (2026-06-07) — RMA + repair linkage
- **Domain**: `src/lib/warranty/linkage.ts` — `issueRmaForClaim` (calls the existing
  `createAuthorization` with direction INBOUND_FROM_CUSTOMER, links `warranty_claims.rma_id`),
  `linkRmaByNumber` (link an existing RMA via `findByNumber`), `handoffToRepair` (INSERT a
  `repair_service` ticket from the claim, link `repair_service_id`, advance APPROVED→IN_REPAIR).
  All guarded with `SELECT … FOR UPDATE`, write `RMA_LINKED` / `REPAIR_HANDOFF` events; reuse,
  never duplicate, the RMA + repair entities.
- **Detail**: `getClaim` now LEFT JOINs `rma_authorizations` + `repair_service`, exposing
  `rmaNumber` + `repairTicket` (ticket # or `RS-<id>`) on `WarrantyClaimDetail`.
- **Routes** (withAuth `warranty.manage` + Zod + idempotent + audit, flag-gated):
  `POST /claims/[id]/rma` (issue or link), `POST /claims/[id]/repair-handoff`. Handoff fires an
  `in_repair` inbox notification.
- **UI**: detail-panel "Linked" section (RMA / repair ticket) + action-footer buttons **Issue
  RMA** (APPROVED/IN_REPAIR, no RMA yet) and **Send to repair** (APPROVED, no ticket yet).
- **Verify**: tsc 0 · test:warranty 24/24 · audit exit 0, 0 ungated writes (538 routes, both new
  routes gated).

### Next (Phase 6)
Supplier report export (CSV), eBay refurb-listing draft (draft-only), post-warranty paid-repair
quoting (`warranty_quotes`).
</content>
</invoke>
