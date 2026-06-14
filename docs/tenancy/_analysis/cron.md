I now have a complete picture. The credentials layer already accepts `orgId` and falls back to env vars only when `orgId === USAV_ORG_ID` — which is exactly the per-org integration blocker. I have everything to write the spec.

---

# Phase D2 — Cron / Background-Job Tenancy Remediation Spec

## 0. Scope & how the cron tier breaks the RLS model

The whole RLS retrofit hinges on one fact (established ground truth): the app connects as `neondb_owner`, which is `BYPASSRLS`, so policies are inert until the runtime DSN switches to a **non-bypass, non-owner role**. The cron tier is the *worst* offender for two compounding reasons:

1. **No session, no GUC.** Cron handlers have no `withAuth` context, so none of them set `app.current_org`. The 7 routes that use `withTenantConnection` are all interactive — **zero cron routes set the GUC.** Even after the role flip, every cron `pool.query` would run with `app.current_org` empty → the loud-fail default in `enforce_tenant_isolation()` (`NULLIF(current_setting('app.current_org',true),'')::uuid`) makes inserts blow up on the NOT-NULL org column and selects return nothing.
2. **Single-tenant by construction.** Every job assumes one tenant. The ones that stamp an org at all stamp the literal `transitionalUsavOrgId()` (= `USAV_ORG_ID`). None iterate `organizations`. Onboarding a 2nd active org means its rows never sync, never get stock alerts, never get carrier polling.

So D2 is two orthogonal fixes per job: **(A)** thread an org through to every write, and **(B)** wrap the body in a per-org sweep that sets the GUC via `withTenantConnection`. Some jobs can do both now; some are blocked.

## 1. Inventory: cron surface

**25 `route.ts` files** under `src/app/api/cron/**`. The "27" count reconciles as: 25 route files + `/api/cron/reconcile-unmatched` is one of those 25 (it is NOT in `vercel.json` — invoked manually/externally), and `vercel.json` lists **26 cron entries** (3 of which are the same `google-sheets/transfer-orders` path on 3 schedules, and 2 are the same `shipping/sync-due` path with different querystrings). So: 25 distinct handlers, 26 Vercel schedule rows.

**Scheduling backends:**
- **Vercel Cron** (`vercel.json` `crons:`) — the live driver for 24 of the 25 handlers. `git.deploymentEnabled:false`.
- **QStash** — `scripts/sync-qstash-schedules.js` reads `src/config/qstash-schedules.json` (**file does not currently exist** → QStash is effectively dormant for the generic path). `scripts/ensure-google-sheets-qstash-schedules.js` is hardcoded to point at `/api/qstash/google-sheets/transfer-orders` (a legacy path, not the `/api/cron/...` one we audited). `package.json` scripts: `qstash:sync`, `qstash:ensure:google-sheets`. **Net: all current production scheduling is Vercel Cron; QStash is legacy/dormant and can be ignored for D2 except to confirm no second scheduler is stamping rows.**
- `reconcile-unmatched` has **no scheduler entry** — orphaned; treat as manual.

## 2. Per-job remediation table

`pool` = raw `@/lib/db` Pool (CAN carry GUC via `withTenantConnection`). `db` = drizzle **neon-http** (`src/lib/drizzle/db.ts`, `drizzle-orm/neon-http` over `@neondatabase/serverless` — **stateless HTTP, CANNOT carry a session GUC**).

| Job (route) | Current org-handling | Tables written | Required change |
|---|---|---|---|
| `cron/cleanup` | None. Pure housekeeping. | `cron_runs` (DELETE), + `api_idempotency_responses` via `runIdempotencyCleanup` | **Org-exempt.** These are global/system tables (cron_runs has no org scope; idempotency cache is request-keyed). Keep single-pass. Confirm neither table is in the 68 RLS set; if `cron_runs` gets an org column later, this stays a cross-org admin sweep (run as a privileged path, not per-tenant). |
| `cron/refresh-reports` | None. | `REFRESH MATERIALIZED VIEW` × `mv_bin_utilization, mv_sku_velocity_30d, mv_dead_stock` | **Org-exempt for now**, but a landmine: MVs aggregate across all orgs. After the role flip, `REFRESH MATERIALIZED VIEW` needs an owner-ish role — keep this on a privileged connection, NOT the tenant role. Long-term: MVs must gain an `organization_id` column or become per-org. Flag as **blocked on MV redesign**. |
| `cron/inventory/drift-check` | None. Uses `pool` + explicit txn. Writes `stock_alerts` with **no organization_id** in the INSERT. Reads view `v_sku_stock_drift`. | `stock_alerts` (INSERT DRIFT, UPDATE resolve) | **Convert to per-org sweep.** `stock_alerts` is a business table needing org scope. Wrap `runDriftCheck` in the canonical sweep; pass the `PoolClient` from `withTenantConnection` into the queries (replace `pool.connect()` with the swept client) so the GUC default fills `organization_id`, and add `organization_id` to the INSERT column list. `v_sku_stock_drift` must become org-aware (filter by GUC) or the cross-org drift leaks. **Blocked until the view is org-scoped.** |
| `cron/stock-alerts` | None. `pool` + txn. INSERTs `stock_alerts` (LOW_STOCK/NEVER_COUNTED/STALE_COUNT) with **no organization_id**; reads `bin_contents`. | `stock_alerts` (INSERT ×3, UPDATE resolve) | **Convert to per-org sweep** (same shape as drift-check). Pass swept client; add `organization_id` to inserts (or rely on GUC default once column added). `bin_contents` reads must be org-filtered (by RLS once GUC is set, or explicit `WHERE organization_id = current_setting(...)`). Immediate-convertible once `bin_contents`/`stock_alerts` carry org + GUC is set. |
| `cron/replenishment-detect` | None. Flag-gated `INVENTORY_V2_REPLENISHMENT`. Delegates to `detectReplenishmentNeeds()` (`@/lib/replenishment/pick-face`). | `replenishment_tasks` (INSERT REQUESTED) — inside lib | **Convert to per-org sweep**; thread `orgId` into `detectReplenishmentNeeds(orgId)` and run it inside `withTenantConnection`. Audit `pick-face.ts` for raw `pool` vs neon-http. |
| `cron/replenishment/sync` | None. Delegates to `runReplenishmentSync()` (`@/lib/replenishment`). | (inside lib — audit) | **Convert to per-org sweep**; thread `orgId`. Audit the lib for the DB client type. |
| `cron/sourcing/scan` | None. Delegates to `runSourcingScanJob` (`@/lib/jobs/sourcing-scan`). | `sourcing_alerts` (INSERT/resolve) — inside lib | **Convert to per-org sweep**; `runSourcingScanJob(orgId)` inside `withTenantConnection`. |
| `cron/sourcing/replenish` | None. Delegates to `runReplenishmentWatch` (`@/lib/jobs/replenishment-watch`). Calls **eBay Browse API**. | sourcing alert escalation + candidate rows — inside lib | **Blocked on per-org integration creds.** eBay client (`src/lib/ebay/browse-client.ts`) defaults `orgId = USAV_ORG_ID` and `getIntegrationCredentials` only env-falls-back for USAV. Per-org sweep requires each org to have its own eBay creds in `organization_integrations`. Convert the DB writes per-org now; gate the eBay call on creds-present. |
| `cron/sku-catalog/refresh-suggestions` | None. Delegates to `refreshAllSuggestions()` (`@/lib/neon/pairing-queries`). | `sku_pairing_suggestions` | **Convert to per-org sweep**; `refreshAllSuggestions(orgId)` inside `withTenantConnection`. Catalog tables are org-scoped. |
| `cron/staff-goals/history` | None. Delegates to `runStaffGoalHistorySnapshotJob({})`. | staff goal history snapshot table(s) | **Convert to per-org sweep**; pass `{ organizationId }`. |
| `cron/workflow-node-stats` | None. Delegates to `runWorkflowNodeStatsSnapshot()` (`@/lib/workflow/node-stats`). | `workflow_node_stats` (INSERT daily snapshot) | **Convert to per-org sweep**; thread `orgId`. Workflow graph is per-tenant. |
| `cron/ebay/refresh-tokens` | None. Delegates to `runEbayRefreshTokensJob` (`@/lib/jobs/ebay-refresh-tokens`). | eBay token/credential rows | **Blocked / per-org integration.** Tokens live per `(org, provider)` in `organization_integrations`. Must iterate orgs that have an eBay integration row and refresh each independently. Not a `withTenantConnection` body change so much as a credentials-table sweep: `SELECT organization_id FROM organization_integrations WHERE provider='ebay'`. |
| `cron/receiving/incoming-tracking-sync` | None. `selectIncomingShipmentIds()` + `syncShipmentsByIds()` + cache bust. | `shipping_tracking_numbers`/event log (inside scheduler) | **Convert to per-org sweep** IF `shipping_tracking_numbers` is org-scoped; `selectIncomingShipmentIds(orgId, cap)` must filter by org. Carrier APIs are global (no per-org creds needed for USPS/FedEx polling) so only the DB scoping changes. |
| `cron/shipping/sync-due` | None. `runShippingSyncDueJob` (`@/lib/jobs/shipping-sync-due`). Auth via `isVercelCronOrigin`. | `shipping_tracking_numbers`, carrier event log | **Convert to per-org sweep** on the shipment selection; carrier creds for FedEx/UPS come from `organization_integrations` (per-org) — see §5. The `?limit/&concurrency/&carriers` budget must be **divided across orgs** or made per-org to avoid timeout blowup. |
| `cron/shipping/reconcile-delivered` | None. `runReconcileDeliveredJob` + `runTrackingMatchReconcileJob` + `runWarrantyClockMaintenance`. Pure SQL. | shipment delivered-state, tracking↔receiving match, warranty claim windows | **Convert to per-org sweep.** Three sub-jobs each touch org-scoped tables (`receiving_*`, warranty_claims). Each must run with the GUC set. Warranty clock is flag-gated + per-org config. |
| `cron/shipping/metrics` | None. Pure reads (`collectShippingTrackingMetrics`). | none (read-only, logs only) | **Org-exempt for correctness** (read-only), but the aggregate counts silently span all orgs once multi-tenant. Low priority: convert to per-org snapshot only when per-tenant dashboards need it. |
| `cron/shipping/subscribe-fedex` | None. `runFedExSubscribeJob`. Calls FedEx AIV API. | FedEx subscription/job rows | **Blocked on per-org FedEx creds** (`organization_integrations` provider='fedex'). Sweep orgs-with-fedex; convert DB writes per-org. |
| `cron/shipping/subscribe-ups` | None. `runUpsSubscribeJob`. Calls UPS API. | UPS subscription rows | **Blocked on per-org UPS creds.** Same shape. (Also noted as possibly-unsupported for 3rd-party numbers; low urgency.) |
| `cron/shipping/subscribe-usps` | None. `runUspsSubscribeJob`. Calls USPS API. | USPS subscription rows | **Blocked on per-org USPS creds** (USPS is free + supports 3rd-party, so highest-value of the three to make per-org). |
| `cron/zoho/po-sync` | Stamps via the lib `syncZohoPoMirror`; route uses raw `pool` for the `email_missing_purchase_orders` auto-resolve UPDATE (no org filter). | `zoho_po_mirror`, `email_missing_purchase_orders` (UPDATE pile='done'), `receiving_lines` (reconcile inside lib) | **Blocked on per-org Zoho creds + per-org Zoho org id.** Zoho `organization_id` (the Zoho-side org) comes from `getIntegrationCredentials(orgId,'zoho')`. Sweep app-orgs that have a zoho integration; run `syncZohoPoMirror` per org with the GUC set; the `email_missing_purchase_orders` UPDATE must filter by `organization_id`. |
| `cron/zoho/incoming-po-sync` | Delegates to `syncZohoPurchaseOrdersToReceiving` (upserts receiving_lines). No app-org threading. | `receiving_lines` (EXPECTED rows), PO/shipment links | **Blocked on per-org Zoho creds.** Same sweep; thread app `orgId` → pull that org's Zoho POs → write its `receiving_lines` with GUC set. |
| `cron/zoho/fulfillment-sync` | `syncShippedOrdersToZoho()` → `orgId = opts.deps?.orgId ?? transitionalUsavOrgId()` (hardcoded USAV). Uses raw `pool` (`PgFulfillmentLedger`) AND drizzle `db`. | `zoho_fulfillment_sync` ledger (INSERT/UPDATE, **stamps organization_id**), + Zoho-side SO/package/shipment/invoice | **Blocked on per-org Zoho creds.** Already takes `orgId` param — pass each swept org instead of the transitional default; run the ledger writes inside `withTenantConnection`. Note `findShippedOrdersForFulfillment` reads internal shipped orders cross-org today → must be org-filtered. |
| `cron/zoho/orders-ingest-drain` | **Best pattern in the tree.** Reads `order_ingest_queue.organization_id` per row; falls back to `transitionalUsavOrgId()` only when the queue row's org is null. Passes `orgId` to `orderSyncService.ingestExternalOrder(orgId, payload)`. Uses raw `pool`. | `order_ingest_queue` (claim/UPDATE status), + orders/customers via OrderSyncService | **Convert claim + per-row work to GUC.** The org is already per-row — wrap each row's ingest in `withTenantConnection(orgId, …)` so OrderSyncService's neon-http writes are replaced by GUC-scoped writes (or keep stamping explicitly). The claim `UPDATE … SKIP LOCKED` is intentionally cross-org (drains all tenants' queues) — keep that on a privileged read, scope only the per-row processing. **This is the template for "row carries its own org".** |
| `cron/google-sheets/transfer-orders` | `runGoogleSheetsTransferOrders(undefined,'sheets')` → stamps `transitionalUsavOrgId()` on inserted `orders`; uses **both** drizzle `db` (orders/customers) AND raw `pool` (work_assignments, order_shipment_links). | `orders` (INSERT/UPDATE/DELETE), `work_assignments`, `order_shipment_links`, + Ably publish | **Blocked: hard single-tenant source + neon-http.** The source spreadsheet ID is a single hardcoded USAV sheet (`SOURCE_SPREADSHEET_ID`), and Ecwid creds are USAV's. The org-stamp is the literal USAV. To go multi-tenant: (a) sheet ID / Ecwid creds must move to per-org `organization_integrations`; (b) the **drizzle `db` inserts cannot carry a GUC** — either keep explicit `organizationId` stamping (current approach, lowest risk) or migrate the orders/customers writes off neon-http onto the `pool` inside `withTenantConnection`. Recommended: **keep explicit org-stamping**, parameterize sheet+org, loop per org. |
| `cron/reconcile-unmatched` | None. `sweepUnmatchedReceivings()`. **No scheduler entry** (orphan). | `receiving_lines` promotion + match writes (inside lib) | **Convert to per-org sweep**; thread `orgId`. Also: either wire into `vercel.json` or formally retire — it is currently un-scheduled. |

### Library hot-spots (shared by the jobs above)

| File | Org-handling today | Required change |
|---|---|---|
| `src/services/OrderSyncService.ts` | **Already parameterized** — `ingestExternalOrder(orgId, …)` stamps `organizationId: orgId` on every repo write. | No signature change. But it routes through `customerRepository`/`itemRepository`/`salesOrderRepository` — audit those for raw `pool` vs neon-http and confirm the org reaches the actual INSERT. Callers must pass a real org (drain does; fulfillment defaultEnsureSalesOrder passes the swept `orgId`). |
| `src/lib/zoho/fulfillment-sync.ts` | `orgId = opts.deps?.orgId ?? transitionalUsavOrgId()`; `PgFulfillmentLedger.save(record, orgId, …)` stamps `organization_id`. Mixes `pool` + drizzle `db` (via repos). | Remove the transitional default; require `orgId` from the sweep. Run `PgFulfillmentLedger` queries inside `withTenantConnection(orgId)`. `findShippedOrdersForFulfillment` must filter by org. |
| `src/lib/jobs/google-sheets-transfer-orders.ts` | Stamps `transitionalUsavOrgId()` on `orders` inserts (explicit, with a comment that neon-http can't carry the GUC). `work_assignments` INSERT stamps `transitionalUsavOrgId()`; `order_shipment_links` upsert has **no org column referenced**. | Add `orgId` param. Replace literal stamps with the param. Decide neon-http vs pool (see job row). `order_shipment_links` and `work_assignments` need org scoping. |
| `src/lib/pipeline/orchestrator.ts` | Stamps `transitionalUsavOrgId()` on `pipeline_tasks`, `pipeline_cycles`. Uses drizzle `db` (neon-http). **This is a CLI loop (`npx tsx`), not a cron route** — runs as a long-lived process. | **Org-exempt / system-internal.** The self-improvement pipeline is a single-tenant dev tool keyed to this repo, not tenant business data. Keep `transitionalUsavOrgId()` or move `pipeline_*` out of the RLS set entirely (classify as system/global). No per-org sweep. |
| `src/lib/pipeline/collect.ts` | Stamps `transitionalUsavOrgId()` on `training_samples` for all 3 collectors. Drizzle `db`. | Same as orchestrator — **system-internal, org-exempt.** Classify `training_samples` as global. |
| `src/lib/realtime/publish.ts` | Stamps `transitionalUsavOrgId()` into `createStationActivityLog(pool, { organizationId })` inside `logRealtimeEventToStationActivity`. Uses raw `pool`. | **Threading problem, not a sweep.** `publish*` is called from request handlers AND crons. The org must flow in from the *caller's* context. Add an `organizationId` field to the realtime payloads (or read it from the already-set GUC via `current_setting`) so `station_activity_logs` is stamped with the true org, not USAV. Where called from a `withTenantConnection` body, prefer reading the GUC; where called from neon-http paths, pass org explicitly. |

## 3. Canonical per-org-sweep wrapper

Add one shared helper (e.g. `src/lib/cron/for-each-org.ts`) so every convertible job uses the identical pattern — active-org enumeration + per-org GUC + per-org error isolation (one tenant's failure never aborts the rest).

```ts
// src/lib/cron/for-each-org.ts
import pool from '@/lib/db';
import { withTenantConnection } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import type { PoolClient } from 'pg';

export interface OrgSweepResult<T> {
  organizationId: OrgId;
  ok: boolean;
  result?: T;
  error?: string;
}

/**
 * Run `fn` once per active organization, each inside its own tenant-scoped
 * connection (app.current_org set), with per-org try/catch isolation.
 *
 * The org list is read on a plain pool query (this enumeration is the one
 * legitimately cross-tenant read — it must NOT itself be tenant-scoped, or it
 * would return only the current org / nothing).
 */
export async function forEachActiveOrg<T>(
  fn: (client: PoolClient, orgId: OrgId) => Promise<T>,
): Promise<{ orgs: number; ok: number; failed: number; results: OrgSweepResult<T>[] }> {
  const { rows } = await pool.query<{ id: OrgId }>(
    `SELECT id
       FROM organizations
      WHERE status = 'active'
        AND deleted_at IS NULL
      ORDER BY created_at`,
  );

  const results: OrgSweepResult<T>[] = [];
  for (const { id: orgId } of rows) {
    try {
      const result = await withTenantConnection(orgId, (client) => fn(client, orgId));
      results.push({ organizationId: orgId, ok: true, result });
    } catch (err) {
      // Isolation: one tenant's failure must never abort the sweep.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron.sweep] org=${orgId} failed: ${message}`);
      results.push({ organizationId: orgId, ok: false, error: message });
    }
  }

  return {
    orgs: rows.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
```

**Usage — DB-only job (immediate-convertible), e.g. `stock-alerts`:**

```ts
const summary = await withCronRun('stock_alerts', async () => {
  return forEachActiveOrg(async (client, orgId) => {
    // client already has app.current_org = orgId set; pass it where the
    // current code does `pool.connect()` / pool.query. INSERTs that previously
    // omitted organization_id now get it from the column DEFAULT
    //   NULLIF(current_setting('app.current_org', true), '')::uuid
    return runStockAlerts(client); // refactor runStockAlerts to accept a client
  });
});
```

**Usage — row-carries-its-own-org job, e.g. `orders-ingest-drain`:** keep the cross-org claim on `pool`, then scope each row:

```ts
for (const row of rows) {
  const orgId = row.organization_id ?? transitionalUsavOrgId();
  await withTenantConnection(orgId, async (client) => {
    await orderSyncService.ingestExternalOrder(orgId, row.payload); // already org-aware
    await client.query(`UPDATE order_ingest_queue SET status='done', ... WHERE id=$1`, [row.id]);
  });
}
```

**Auth note:** all sweeps stay behind the existing `isAuthorizedCronRequest` / `isVercelCronOrigin` guard — no change. The sweep changes only what happens *after* auth.

## 4. Convert-now vs blocked

**Convert immediately** (DB-only, org column + GUC is the entire fix; no external per-org creds needed; raw `pool` so GUC works):
- `cron/inventory/drift-check` (after `v_sku_stock_drift` is made org-aware)
- `cron/stock-alerts`
- `cron/sourcing/scan`
- `cron/sku-catalog/refresh-suggestions`
- `cron/staff-goals/history`
- `cron/workflow-node-stats`
- `cron/replenishment-detect`, `cron/replenishment/sync` (verify libs use `pool`, not neon-http)
- `cron/shipping/reconcile-delivered` (pure SQL on org-scoped tables)
- `cron/receiving/incoming-tracking-sync` (carrier APIs are global; only shipment selection needs org)
- `cron/zoho/orders-ingest-drain` (org already per-row — just wrap in GUC)
- `cron/reconcile-unmatched` (also needs (un)scheduling decision)

**Blocked — per-org external credentials** (need `organization_integrations` rows per tenant; `getIntegrationCredentials` only env-falls-back for `USAV_ORG_ID`, and `browse-client.ts`/Zoho clients default to USAV):
- All three `cron/shipping/subscribe-{fedex,ups,usps}` (carrier account creds per org; USPS highest value)
- `cron/shipping/sync-due` (FedEx/UPS account creds per org for full coverage; USPS/poll works without)
- `cron/ebay/refresh-tokens`, `cron/sourcing/replenish` (eBay creds per org)
- `cron/zoho/po-sync`, `cron/zoho/incoming-po-sync`, `cron/zoho/fulfillment-sync` (Zoho creds + Zoho-org-id per app-org)

**Blocked — neon-http + hardcoded single-tenant source:**
- `cron/google-sheets/transfer-orders` (single hardcoded `SOURCE_SPREADSHEET_ID`; Ecwid creds USAV-only; writes via drizzle `db` which can't carry a GUC). Path: parameterize sheet/Ecwid per org, and either keep explicit `organizationId` stamping or migrate orders/customers writes onto `pool` inside `withTenantConnection`. The **17 neon-http routes / paths cannot carry the GUC** — anything writing through `src/lib/drizzle/db.ts` must either be migrated to the `pool` client or keep stamping `organizationId` explicitly.

**Org-exempt (do NOT per-org-ify):**
- `cron/cleanup`, `cron/refresh-reports` (global/system + MV refresh needs a privileged role, not the tenant role — keep off the per-org sweep; MV multi-tenant correctness is a separate redesign)
- `cron/shipping/metrics` (read-only; convert only when per-tenant dashboards need it)
- `src/lib/pipeline/orchestrator.ts` + `src/lib/pipeline/collect.ts` (self-improvement CLI tool; classify `pipeline_*` and `training_samples` as system/global, keep `transitionalUsavOrgId()`)

## 5. Hard cross-cutting blockers to land before/with the sweep

1. **Role flip is the precondition for *all* of this mattering** — until the cron runtime DSN uses a non-`BYPASSRLS` role, the GUC does nothing. But note: a non-owner tenant role likely *also* loses `REFRESH MATERIALIZED VIEW` and the cross-org `organizations` enumeration privileges. The sweep helper's org-enumeration query and the MV refresh must run on a **separate privileged connection** (a 2nd Pool / DSN), not the tenant role. Plan a two-pool split: `adminPool` (owner-ish, for enumeration + MV + cleanup + cross-org claims) and the tenant `pool` used inside `withTenantConnection`.
2. **`getIntegrationCredentials` env-fallback is USAV-only** (`src/lib/integrations/credentials.ts:219` `if (orgId === USAV_ORG_ID)`). Every integration-backed cron stays single-tenant until non-USAV orgs have real `organization_integrations` rows. This is the gating dependency for the entire "blocked — per-org creds" group.
3. **neon-http inventory.** Any job whose lib writes through `src/lib/drizzle/db.ts` (`google-sheets-transfer-orders`, `fulfillment-sync` repos, `pipeline/*`, OrderSyncService repos) cannot enforce via GUC — they must keep explicit `organizationId` stamping or be migrated to the `pool`. This is the single most important per-job decision flag.
4. **Cross-org budget math.** `shipping/sync-due` and the subscribe jobs run with a fixed `limit`/`concurrency` budget; a naive per-org loop multiplies wall-clock by org count and will blow `maxDuration`. Make the limit per-org-fair (divide budget) or shard orgs across schedule ticks.
5. **`reconcile-unmatched` is orphaned** (no `vercel.json`/QStash entry) — decide schedule-or-retire as part of D2.
6. **QStash is dormant** — `src/config/qstash-schedules.json` does not exist; the only live `ensure` script targets a legacy `/api/qstash/google-sheets/transfer-orders` path. Confirm no QStash schedule is independently hitting these handlers before relying solely on `vercel.json`.

**Key file references:** sweep target list — `src/lib/drizzle/schema.ts:2285` (`organizations`: `status` default 'active', `deletedAt`, `idx_organizations_status`); GUC wrappers — `src/lib/tenancy/db.ts:42/84` (`withTenantConnection`/`withTenantTransaction`), `:112` `transitionalUsavOrgId`; neon-http client — `src/lib/drizzle/db.ts:3-10`; creds gate — `src/lib/integrations/credentials.ts:219`; cron auth — `src/lib/cron/auth.ts:34/46`; schedulers — `vercel.json` (`crons:`), `scripts/sync-qstash-schedules.js`, `scripts/ensure-google-sheets-qstash-schedules.js`.