I now have complete data. Here is the spec.

---

# Phase C5 — Repositories & Query Choke-Points + neon-http Blocker Spec

## TL;DR

The repositories under `src/lib/repositories/**` and the workflow store/tap are **all built on the stateless Drizzle `neon-http` client** (`src/lib/drizzle/db.ts` → `drizzle(neon(...))`). The pg pool (`src/lib/db.ts`) is actually a **Neon WebSocket `Pool`** typed as `pg.Pool` — so it *can* run multi-statement transactions and carry `SET app.current_org`. The `neon-http` client cannot (one HTTP round-trip per statement).

The choke-point files split into two groups:

- **pg-client based, already transaction-capable** (`tech-serial.ts`, `unit-events.ts`, `repairs-queries.ts`): these need an `orgId` thread + WHERE filter, but no transport change. `tech-serial.ts` already has the `organizationId` param half-wired.
- **neon-http based** (`stockLedger.ts`, `inventoryEvents.ts`, `serialUnits.ts`, `allocations.ts`, `conditionHistory.ts`, `locations.ts`, `workflow/store.ts`, `workflow/tap.ts`, `node-stats.ts`, and the 4 generic repos): these need orgId threaded AND a transport decision before RLS can ever be enforced on their tables.

**Three tenant tables — `item_workflow_state`, `workflow_runs`, `workflow_node_stats` — plus `zoho_locations` — are reachable ONLY via neon-http** (0 pg-pool references). They are therefore blocked from RLS enforcement until migrated to the pooled driver (or given explicit org filters + left un-enforced).

---

## (1) Exported functions that need an `orgId` parameter threaded + applied as a WHERE / INSERT filter

For each: today's behavior, what to add. Tables are tenant-owned with `organization_id NOT NULL` and a session-default of `NULLIF(current_setting('app.current_org',true),'')::uuid` — so **inserts on neon-http insert NULL into a NOT NULL column unless org is passed explicitly**, and reads return cross-tenant rows because there's no GUC and no filter.

### `src/lib/repositories/inventory/stockLedger.ts`  (table `sku_stock_ledger` — tenant-owned, RLS ON, iso policy present)
- `appendLedgerRow(input)` — INSERT has **no `organizationId`**. On neon-http there is no GUC, so the NOT NULL default resolves to NULL → **insert currently fails or, where a backfill default still exists, lands in the wrong tenant**. Add `orgId` to `AppendLedgerInput` and set `organizationId: input.orgId` in `.values({...})`.
- `listLedgerForSku(sku, opts)` — add `eq(skuStockLedger.organizationId, orgId)` to `filters`.
- `ledgerSum(sku, dimension)` — raw `db.execute(sql\`...\`)`; add `AND organization_id = ${orgId}` to the WHERE.
- Signature change: thread `orgId: OrgId` into all three (either a leading param or on the opts/input object).

> Note: the pg-transaction sibling in `src/lib/inventory/unit-events.ts` (step 3) writes `sku_stock_ledger` directly via `client.query(...)` and **omits `organization_id`** from the column list — that INSERT also needs the column added (see below).

### `src/lib/repositories/inventory/inventoryEvents.ts`  (table `inventory_events` — tenant-owned, RLS ON, iso policy present)
- `appendInventoryEvent(input)` — INSERT omits `organizationId`; same NULL-into-NOT-NULL problem. The existing-row idempotency `.select().where(eq(clientEventId,...))` is also **globally scoped** — a `clientEventId` collision from another tenant would return a foreign row. Add `orgId` to `AppendEventInput`; set `organizationId` on insert; add `eq(inventoryEvents.organizationId, orgId)` to both idempotency lookups.
- `listEventsForSerialUnit(serialUnitId, limit)`, `listEventsForSku(sku, limit)`, `listEventsForReceivingLine(receivingLineId, limit)`, `listRecentEventsByType(eventType, opts)` — each needs an `orgId` param ANDed into the WHERE.

### `src/lib/repositories/inventory/serialUnits.ts`  (table `serial_units` — tenant-owned, RLS ON, iso policy present)
- `upsertSerialUnit(input)` — INSERT omits org; the `onConflictDoUpdate` target is `normalizedSerial` (a **global** unique key), so two tenants with the same serial would collide/merge. Add `orgId` to insert values; the unique index likely needs to become `(organization_id, normalized_serial)` (schema concern, flag to migration owner).
- `findSerialUnitByNormalized(normalized)`, `findSerialUnitBySerial(serial)`, `getSerialUnitById(id)` — add `orgId` and AND it into each WHERE.

### `src/lib/repositories/inventory/allocations.ts`  (table `order_unit_allocations` — tenant-owned, RLS ON, iso present)
- `allocate(input)` — INSERT omits org. Add `orgId`.
- `advanceState(input)`, `release(input)` — UPDATEs filter only by `id`; add `eq(orderUnitAllocations.organizationId, orgId)` so a guessed id can't mutate another tenant's allocation.
- `findOpenAllocationForUnit(serialUnitId)`, `listAllocationsForOrder(orderId)` — AND org into WHERE.

### `src/lib/repositories/inventory/conditionHistory.ts`  (table `serial_unit_condition_history` — tenant-owned, RLS ON, iso present)
- `recordChange(input)` — INSERT omits org. Add `orgId`.
- `listHistoryForUnit(serialUnitId, direction)` — AND org into WHERE.

### `src/lib/repositories/inventory/locations.ts`  (tables `locations`, `bin_contents` — tenant-owned, RLS ON, iso present)
- `findLocationByBarcode`, `findLocationByName`, `getLocationById`, `listBins`, `listBinContentsByLocation`, `listBinContentsBySku` — all reads; add `orgId` ANDed into each WHERE.
- `totalBinQtyForSku(sku)` — raw `db.execute`; add `AND organization_id = ${orgId}`.

### `src/lib/workflow/store.ts`  (tables `item_workflow_state`, `workflow_nodes`, `workflow_edges`, `workflow_runs`)
This file is the **best existing template** — `createDrizzleStore(orgId)` already captures org and `recordRun`/`enrollItem` already pass `organizationId` explicitly. Gaps:
- `loadState(serialUnitId)` — `where(eq(itemWorkflowState.serialUnitId, ...))` only; add `eq(itemWorkflowState.organizationId, orgId)`.
- `moveTo(state, ...)` and `setStatus(state, ...)` — UPDATE filters only by `serialUnitId`; add the org predicate.
- `loadNode` / `resolveNext` — read `workflow_nodes` / `workflow_edges`, which are `child-scoped(workflow_definitions)` (no own org column). These stay filtered via `workflowDefinitionId`; acceptable **only if the caller already validated the definition belongs to `orgId`**. Recommend adding a definition-ownership check at enroll/advance entry.

### `src/lib/workflow/tap.ts`  (reads `workflow_definitions`, writes via store)
- `findEntryNode(orgId)` / `loadEntryNode(orgId)` already filter `eq(workflowDefinitions.organizationId, orgId)` — good. Keep the `orgId` it derives from `state?.organizationId ?? args.orgId` flowing into `createDrizzleStore(orgId)`.

### `src/lib/workflow/node-stats.ts`  (table `workflow_node_stats`, reads `item_workflow_state`)
- `runWorkflowNodeStatsSnapshot()` — currently a **global GROUP BY across all tenants** in one raw `db.execute`. It writes `organization_id` from the source rows (so per-tenant rows are produced), but it reads every tenant's `item_workflow_state` in one statement. Take an `orgId` and add `AND s.organization_id = ${orgId}` (and run per-tenant), OR accept it as a system-level aggregator that must run as a privileged role even after RLS (document which).

### pg-client choke-points (need orgId thread, NOT transport change)

`src/lib/inventory/tech-serial.ts` (`tech_serial_numbers` — tenant-owned, RLS ON, iso present)
- `attachTechSerial(input, executor)` — already has `input.organizationId` bound conditionally. The comment says "omit → DB default applies." **That default only works under the pg pool when the session GUC is set; via the bare `pool` default executor (no GUC), it inserts NULL or the fallback org.** Make `organizationId` **required** when called outside a `withTenantConnection`/`withTenantTransaction` client, and bind it unconditionally. No SELECT to filter here (insert-only).

`src/lib/inventory/unit-events.ts` (writes `sku_stock_ledger` raw, calls `upsertSerialUnit`, `attachTechSerial`, `recordInventoryEvent`)
- `recordUnitEvent(input, client)` — add `orgId` to `RecordUnitEventInput`. The inline `INSERT INTO sku_stock_ledger (...)` at lines 144-160 **does not list `organization_id`** — add the column + `$N` param. Pass `orgId` down to `attachTechSerial` and to the pg-client `recordInventoryEvent`/`upsertSerialUnit` calls. Because this runs on a real `PoolClient`, the cleanest fix is to require callers to obtain the client via `withTenantTransaction(orgId, ...)` so the GUC default fills every column — then the explicit thread is belt-and-suspenders.

`src/lib/neon/repairs-queries.ts` (tables `unit_repairs`, `repair_failure_resolutions` — both currently **no org column**: `child-scoped` / `tenant-owned-NEEDS-COL`; plus `unit_failure_tags`, `serial_units`)
- `listUnitRepairs(serialUnitId)` — pg pool, no GUC, no filter. Once `unit_repairs`/`unit_failure_tags` get an org column, AND it in; until then it inherits scoping from `serial_unit_id`. Add `orgId` param now to future-proof.
- `openRepair(params)` / `updateRepair(repairId, params)` — use `pool.connect()` BEGIN/COMMIT directly (NOT `withTenantTransaction`), so even after these tables get org columns + RLS, **the GUC is never set and the inserts would write NULL**. Two required changes: (a) switch the `pool.connect()` to `withTenantTransaction(orgId, ...)` (or set_config at BEGIN), (b) the post-commit `appendInventoryEvent(...)` (neon-http) must be passed `orgId` per the inventoryEvents change above. Thread `orgId` into both function signatures.

### Generic repos (same pattern, lower-risk reads/upserts; tenant tables)
- `src/lib/repositories/customerRepository.ts` (`customers`) — `getById`, `getByEmail`, `findOrCreate` upsert path: add org filter + insert org.
- `src/lib/repositories/itemRepository.ts` (`items`, `zoho_locations`) — `getById`, `getByZohoId`, `getBySku`, paginated `list`, `count`, and `getLocations` (zoho_locations): add org.
- `src/lib/repositories/salesOrderRepository.ts` (`sales_orders`) — `getByReferenceNumber` + writers: add org.
- `src/lib/repositories/syncCursorRepository.ts` (`sync_cursors`) — `get(resource)` + upsert: add org. (Note: sync cursors may legitimately be system-global per integration — confirm with classification before filtering.)

---

## (2) The structural problem with Drizzle `neon-http`, and the fix options

### The problem
`src/lib/drizzle/db.ts`:
```ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
export const client = neon(connectionString);
export const db = drizzle(client, { schema });
```
`neon-http` sends **each SQL statement as an independent HTTP request** to the Neon SQL-over-HTTP endpoint. There is **no persistent session**, so:
1. `SET app.current_org` / `set_config('app.current_org', ..., false)` set on one request **does not survive** to the next request — the GUC the RLS policies (`organization_id = current_setting('app.current_org')::uuid`) and the column DEFAULT (`NULLIF(current_setting('app.current_org',true),'')::uuid`) read is **always empty** on this transport.
2. You cannot wrap a multi-statement `BEGIN … COMMIT` across HTTP requests, so neon-http writes also **cannot co-commit** with the pg-pool transactions in `unit-events.ts` / `repairs-queries.ts` (this is exactly the "TRANSPORT WARNING" already documented in `inventoryEvents.ts` lines 80-88 and `tech-serial.ts` lines 12-19).

Net: **any table only ever touched via `db` (neon-http) cannot have working column-default org-stamping and cannot have an enforceable RLS policy** — because the role would need the GUC and the GUC can't be carried.

### Option A — Move the neon-http paths onto the pooled Neon-WS driver inside `withTenantConnection` (RECOMMENDED)
The pg pool in `src/lib/db.ts` is already `new NeonPool(...)` (Neon's **WebSocket** `Pool`) cast to `pg.Pool`. WebSocket holds a session, so `set_config('app.current_org', $1, false)` persists and `BEGIN/COMMIT` works — `withTenantConnection` / `withTenantTransaction` (`src/lib/tenancy/db.ts`) already do exactly this.

Two sub-approaches:
- **A1 (preferred): use a Drizzle WS adapter** — add a second Drizzle instance built on `drizzle-orm/neon-serverless` (the WS-pool flavor, already shipped in `@neondatabase/serverless@^1.0.2` + `drizzle-orm@^0.45.1`) over a checked-out client, so the repos keep their typed query builder but run on a session-carrying connection inside the tenant GUC:
  ```ts
  // src/lib/drizzle/tenant-db.ts (new)
  import { drizzle } from 'drizzle-orm/neon-serverless';
  import pool from '@/lib/db';            // the NeonPool(WS) cast as pg.Pool
  import * as schema from './schema';
  import type { OrgId } from '@/lib/tenancy/constants';

  export async function withTenantDrizzle<T>(orgId: OrgId, fn: (tdb) => Promise<T>): Promise<T> {
    const client = await (pool as any).connect();
    try {
      await client.query("SELECT set_config('app.current_org', $1, false)", [orgId]);
      const tdb = drizzle(client, { schema });
      return await fn(tdb);
    } finally {
      try { await client.query("SELECT set_config('app.current_org','',false)"); } catch {}
      client.release();
    }
  }
  ```
  Then each repo function becomes `(orgId, ...)` and runs its existing query builder against `tdb`. With the GUC set, the column DEFAULT and the RLS policy both work, so the explicit org thread from (1) becomes a defense-in-depth backstop rather than the sole mechanism.
- **A2: rewrite the hot repos to raw `tenantQuery(orgId, sql, params)` / `withTenantTransaction`** (the `src/lib/inventory/*` style) and drop Drizzle for those tables. More churn, but unifies on one transport and lets `unit-events.ts` / `repairs-queries.ts` co-commit the event row in the same transaction (closes the "best-effort event after commit" gap in `repairs-queries.ts`).

### Option B — Per-query WS transaction wrapper that prepends `set_config` (narrowest change)
Keep neon-http for cold/read paths; for the writes that must be tenant-correct, run a one-shot WS transaction:
```ts
await withTenantTransaction(orgId, async (client) => {
  await client.query("INSERT INTO sku_stock_ledger (...) VALUES (...)", params);
});
```
This is really a special case of A2 applied surgically. Good as an incremental migration step, but it abandons the Drizzle builder for those calls.

### Option C — Keep neon-http, add explicit org filters everywhere, and NEVER enforce RLS on those tables
Do all of (1) — thread `orgId`, filter every WHERE, stamp every INSERT — but accept that `app.current_org` is never set on this transport, so:
- the column DEFAULT can't stamp org (must pass it explicitly, always), and
- you can run `enforce_tenant_isolation()` (FORCE RLS) on these tables **only if the app connects as a bypassrls role** — which defeats the whole RLS fix. So these tables would stay **app-filtered but RLS-inert** (the WHERE clause is the only guard).

### Recommendation
**Option A1**: introduce `withTenantDrizzle(orgId, fn)` on the existing Neon **WS** pool and migrate the choke-point repos onto it, while also doing the explicit org threading from (1) as a backstop. Rationale specific to this repo:
- The WS pool already exists (`src/lib/db.ts` `NeonPool`) and `withTenantConnection`/`withTenantTransaction` already prove the GUC pattern works — minimal new infrastructure.
- It keeps the typed Drizzle query builders the repos are written in (low rewrite risk vs A2).
- It makes the column DEFAULT and RLS policy actually function, so these tables can be moved through `enforce_tenant_isolation()` once the app's **non-bypassrls connection role** lands (the separate, already-identified prerequisite).
- For the two pg-client choke-points that must co-commit (`unit-events.ts`, `repairs-queries.ts`), prefer A2/B (run them inside `withTenantTransaction`) so the event + ledger rows are atomic and org-stamped — A1 is for the standalone Drizzle repos.

---

## (3) Tenant tables reachable ONLY via neon-http (blocked from RLS enforcement until migrated)

Verified by grepping every table name across all 453 pg-pool-importing files (`from '@/lib/db'`) vs the 34 neon-http importers:

| Table | Classification | org/RLS today | Reachable only via neon-http? |
|---|---|---|---|
| `item_workflow_state` | tenant-owned | org NOT NULL, **RLS OFF, no iso policy** | **YES** — 0 pg-pool refs (written via `workflow/store.ts`, read via `node-stats.ts`) |
| `workflow_runs` | tenant-owned | org NOT NULL, **RLS OFF, no iso policy** | **YES** — 0 pg-pool refs (written via `workflow/store.ts` `recordRun`) |
| `workflow_node_stats` | tenant-owned | org NOT NULL, **RLS OFF, no iso policy** | **YES** — 0 pg-pool refs (written via `node-stats.ts`, raw `db.execute`) |
| `zoho_locations` | (tenant via itemRepository) | — | **YES** — 0 pg-pool refs (read via `itemRepository.getLocations`) |

These four cannot have a working RLS policy until they move off neon-http, because the policy's `current_setting('app.current_org')` is always empty on that transport. The three `workflow_*` tables are also **not yet RLS-enabled** (no iso policy), so they need both the transport migration (Option A1) AND a run through `enforce_tenant_isolation()` before they're protected.

**Adjacent tables that are dual-reachable** (touched by BOTH neon-http and pg-pool) — these are NOT blocked, because the pg-pool path can already carry the GUC; you only need to migrate/guard the neon-http callers and the pg callers consistently:
- `sku_stock_ledger` (15 pg files), `inventory_events` (34), `serial_units` (45), `tech_serial_numbers` (30), `locations` (24), `bin_contents` (12), `order_unit_allocations` (8), `serial_unit_condition_history` (2), `workflow_definitions` (4), `workflow_nodes` (3), `workflow_edges` (3), `sync_cursors` (2), `customers`, `items`, `sales_orders`.

> Caveat for the dual-reachable set: even though a pg path *can* carry the GUC, most pg callers today use the **raw `pool`** (not `withTenantConnection`) — so until those are migrated too, the neon-http and bypassrls realities mean RLS stays inert regardless. The per-table blocker for *RLS enforcement* is (a) the app role must lose BYPASSRLS, and (b) **every** writer/reader of the table must carry the GUC. The four neon-http-only tables above are blocked at step (b) by transport alone.

---

## Suggested execution order for C5
1. Add `src/lib/drizzle/tenant-db.ts` (`withTenantDrizzle(orgId, fn)` over the Neon WS pool) — Option A1 infra.
2. Migrate the workflow trio first (`workflow/store.ts`, `node-stats.ts`, `tap.ts`) onto `withTenantDrizzle` — they're neon-http-only and the highest-value unblock; `createDrizzleStore(orgId)` already carries orgId so the diff is smallest.
3. Thread `orgId` + WHERE/INSERT filters through the 6 inventory repos and 4 generic repos (part 1), running them via `withTenantDrizzle`.
4. Convert `repairs-queries.ts` `openRepair`/`updateRepair` and `unit-events.ts` `recordUnitEvent` to `withTenantTransaction(orgId, ...)`; add `organization_id` to the inline `sku_stock_ledger` INSERT; make `attachTechSerial`'s `organizationId` required off-GUC.
5. Only after the app's non-bypassrls connection role is in place: run `enforce_tenant_isolation()` on the workflow trio + any remaining tenant tables in this set.

Files cited: `src/lib/drizzle/db.ts`, `src/lib/db.ts`, `src/lib/tenancy/db.ts`, `src/lib/repositories/inventory/{stockLedger,inventoryEvents,serialUnits,allocations,conditionHistory,locations,index}.ts`, `src/lib/repositories/{customerRepository,itemRepository,salesOrderRepository,syncCursorRepository}.ts`, `src/lib/inventory/{unit-events,tech-serial}.ts`, `src/lib/neon/repairs-queries.ts`, `src/lib/workflow/{contract,store,tap,node-stats}.ts`, `docs/tenancy/coverage.generated.json`.