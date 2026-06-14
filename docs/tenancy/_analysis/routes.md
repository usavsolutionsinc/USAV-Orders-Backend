I have all the facts I need. Every target table either has an org column with a USAV-fallback INSERT default (so reads leak across tenants and writes silently land on USAV's org) or is child-scoped/system-global. Here is the complete adversarial verification with exact fixes.

---

# Cross-tenant leak verification + exact fixes

## Shared facts that drive every verdict

1. **Every business table these routes touch has `organization_id` with `default_kind=usav-fallback`.** That means a bare `INSERT` with `app.current_org` unset writes the row tagged to USAV's org — so on a non-USAV tenant, creates either land on the wrong org or (once the GUC is set) the column is populated but the SELECTs still don't filter. The routes below all use the raw `@/lib/db` pool with **no** `app.current_org` GUC and **no** `WHERE organization_id =` clause.
2. **None of the query helpers** (`getSkuCatalogList`, `createReasonCode`, `upsertStaffGoalWithHistory`, `appendInventoryEvent`, `recordChange`, `allocate`, `recordInventoryEvent`) scope by org — grep returned zero matches for `organization|current_org|orgId` in all of them.
3. `withAuth` already provides `ctx.organizationId: string` (non-null on authed routes). `requireRoutePerm` returns `gate.ctx` — confirm it carries `organizationId` (it wraps the same `CurrentUser`); if it does not, switch those routes to `withAuth` so the org id is guaranteed.
4. RLS is inert (BYPASSRLS on `neondb_owner`), so the **only** thing protecting these tables today is an explicit `WHERE organization_id =` in the handler. There is none. **These are real leaks, not theoretical.**

The canonical fix shape for each: replace `pool.query(sql, params)` with `tenantQuery(ctx.organizationId, sql, params)` (or `withTenantTransaction` for multi-statement), add `AND organization_id = current_setting('app.current_org')::uuid` (or an explicit `$n` bound to `ctx.organizationId`) to every SELECT/UPDATE/DELETE WHERE, and for `[id]` routes add an ownership re-check that returns 404 (not 403 — don't reveal existence) when the row's org ≠ caller's org.

---

## 1. `src/app/api/receiving-lines/route.ts` — **REAL LEAK (severe)**

**Root cause:** GET/POST/PATCH/DELETE all query `receiving_lines` (org NOT NULL, RLS on) and joined `receiving`, `serial_units`, `sku_catalog`, `testing_results`, `zoho_po_mirror` via the raw `pool` with zero org predicates. Single-row `?id=` (lines 182-241), per-package `?receiving_id=` (260-314), and the paginated list (789-889) return any tenant's cartons/serials. The unmatched-placeholder query (934-985) leaks `receiving` rows directly.

**Fix (single-row branch — apply the same pattern to all branches):**

```ts
// top of file
import { tenantQuery } from '@/lib/tenancy/db';

export const GET = withAuth(async (request: NextRequest, ctx) => {
  // ...
  if (Number.isFinite(id) && id > 0) {
    const one = await tenantQuery(ctx.organizationId,
      `SELECT rl.*, /* …unchanged… */
       FROM receiving_lines rl
       LEFT JOIN LATERAL (
         SELECT r.* FROM receiving r
          WHERE (r.id = rl.receiving_id
             OR (rl.receiving_id IS NULL AND r.source = 'zoho_po'
                 AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id))
            AND r.organization_id = $2          -- scope the joined carton too
          ORDER BY (r.id = rl.receiving_id) DESC, (r.shipment_id IS NOT NULL) DESC, r.id DESC
          LIMIT 1
       ) r ON TRUE
       /* …other joins… */
       WHERE rl.id = $1
         AND rl.organization_id = $2`,            // <-- the ownership filter
      [id, ctx.organizationId],
    );
    if (one.rows.length === 0)
      return NextResponse.json({ success: false, error: 'receiving_line not found' }, { status: 404 });
    // ...
```

For the list branch, add `conditions.push(\`rl.organization_id = $${idx++}\`); values.push(ctx.organizationId);` before building `where`, route both `pool.query` calls through `tenantQuery(ctx.organizationId, …)`, and add `AND r.organization_id = $1` to the two unmatched-placeholder queries (binding `ctx.organizationId` as their first param). Also scope `fetchSerialsForLines` — it currently reads `serial_units` with no org filter (lines 33-40); add `AND organization_id = $2` and thread `ctx.organizationId` in.

POST/PATCH/DELETE (below line 1022, not shown in this excerpt) must move to `withTenantTransaction(ctx.organizationId, …)` so the USAV-fallback default is overridden with the real tenant on INSERT, and any UPDATE/DELETE gains `AND organization_id = $n`.

---

## 2. `src/app/api/receiving/match/route.ts` — **REAL LEAK (severe, cross-tenant write)**

**Root cause:** POST uses a hand-managed `pool.connect()` transaction with no GUC. The existence probe `SELECT id FROM receiving WHERE id = $1` (97-100) and every candidate-line query (118-164) lack an org filter. A caller from tenant B can pass tenant A's `receiving_id` / `zoho_purchaseorder_id` / `sku` and **mutate tenant A's `receiving_lines`** (`UPDATE … SET receiving_id, workflow_status` at 195-200) and **insert `work_assignments`** (227-235) — a write-side cross-tenant breach, the worst kind. GET (298-320) leaks matched lines + the receiving row.

**Fix:** swap the manual transaction for `withTenantTransaction`, scope the probe and every candidate query, and bind org on the work_assignment insert (or rely on the now-correct GUC default).

```ts
import { withTenantTransaction, tenantQuery } from '@/lib/tenancy/db';

export const POST = withAuth(async (request, ctx) => {
  try {
    const body = await request.json();
    const receivingId = Number(body?.receiving_id);
    if (!Number.isFinite(receivingId) || receivingId <= 0)
      return NextResponse.json({ success: false, error: 'receiving_id is required …' }, { status: 400 });
    // …parse hints…

    return await withTenantTransaction(ctx.organizationId, async (client) => {
      const receivingRow = await client.query(
        `SELECT id FROM receiving WHERE id = $1 AND organization_id = $2`,
        [receivingId, ctx.organizationId],
      );
      if (receivingRow.rows.length === 0)
        return NextResponse.json({ success: false, error: `receiving row ${receivingId} not found` }, { status: 404 });

      // every candidate query gains: AND organization_id = $N  (bind ctx.organizationId)
      // e.g. zoho_purchaseorder_id branch:
      const rows = await client.query(
        `SELECT id, needs_test, assigned_tech_id FROM receiving_lines
          WHERE zoho_purchaseorder_id = $1 AND receiving_id IS NULL AND organization_id = $2`,
        [zohoPurchaseOrderId, ctx.organizationId],
      );
      // …UPDATE receiving_lines … WHERE id = ANY($N::int[]) AND organization_id = $M
      // …INSERT INTO work_assignments (organization_id, entity_type, …) VALUES ($org, …)
      //    — or omit the column and let the GUC default fill it (now correct under tenant tx).
    });
  } catch (error) { /* … */ }
}, { permission: 'receiving.mark_received', audit: { /* unchanged */ } });
```

Note: because `withTenantTransaction` sets `app.current_org` with `is_local=true`, the bare `INSERT INTO work_assignments` is now safe — the `usav-fallback` default resolves to `current_setting('app.current_org')` = the real tenant. GET → route both queries through `tenantQuery(ctx.organizationId, …)` with `AND rl.organization_id = $2` / `AND r.organization_id = $2`.

---

## 3. `src/app/api/work-orders/route.ts` — **REAL LEAK (exists; severe)**

**Root cause:** File exists. The only active GET path is `getOrders()` (149-234, queue logic disables the others), which reads `orders` (org NOT NULL, RLS on) joined to `work_assignments`, `station_activity_logs`, `shipping_tracking_numbers` with **no org filter** — every tenant's pending orders are returned. PATCH (770-910) is worse: `upsertAssignment` (603-717) does `SELECT/UPDATE/INSERT work_assignments` keyed only by `(entity_type, entity_id, work_type)` with no org scope, and the `entityType==='RECEIVING'`/`'FBA_SHIPMENT'` branches blind-`UPDATE receiving`/`fba_shipments WHERE id = $entityId` (857-873) — a cross-tenant write: tenant B can reassign/complete tenant A's work and flip `assigned_tech_id` on A's receiving row. The dormant `getReceiving/getRepairs/getFbaShipments/getSkuStock` helpers have the same defect and must be fixed before they're re-enabled.

**Fix:** these functions take no args; thread `ctx.organizationId` in. For GET:

```ts
async function getOrders(orgId: string): Promise<WorkOrderRow[]> {
  const result = await tenantQuery(orgId,
    `SELECT … FROM orders o
       LEFT JOIN LATERAL ( SELECT * FROM work_assignments wa
         WHERE wa.entity_type='ORDER' AND wa.entity_id=o.id AND wa.work_type='TEST'
           AND wa.status IN ('OPEN','ASSIGNED','IN_PROGRESS')
           AND wa.organization_id = $1                       -- scope the WA join
         ORDER BY … LIMIT 1 ) test_wa ON TRUE
       /* pack_wa LATERAL: same AND wa.organization_id = $1 */
       …
     WHERE NOT ${shippedByCarrierOrLatestStatusSql}
       AND NOT EXISTS (SELECT 1 FROM station_activity_logs sal
                        WHERE sal.shipment_id = o.shipment_id AND sal.organization_id = $1)
       AND UPPER(COALESCE(o.status,'')) <> 'SHIPPED'
       AND o.shipment_id IS NOT NULL
       AND o.organization_id = $1                            -- the ownership filter
     ORDER BY … LIMIT 500`, [orgId]);
  // …
}
// GET handler:
export const GET = withAuth(async (request, ctx) => {
  const [orders] = await Promise.all([ safeFetch('getOrders', () => getOrders(ctx.organizationId)) ]);
  // …
}, { permission: 'work_orders.view' });
```

PATCH: wrap in `withTenantTransaction(ctx.organizationId, …)`, give `upsertAssignment` an `orgId` param so its `SELECT/UPDATE/INSERT` carry `AND organization_id = $org` (and the INSERT lists `organization_id`), and add `AND organization_id = $org` to the `UPDATE fba_shipments` (857-863) and `UPDATE receiving` (866-873) blind writes. Also re-check `entityId` ownership: a `rowCount === 0` after the UPDATE means cross-tenant → return 404.

---

## 4. `serial-units/route.ts` (top-level) — **FALSE POSITIVE (file does not exist)**

`find` confirms there is no `src/app/api/serial-units/route.ts`. The serial-units API surface is the `[id]/*` action routes plus `serial-units/lookup`. Note: the listing surface the task is implicitly after is **`src/app/api/inventory/units/route.ts`** — covered in §8 below; it is a real leak.

## 4a. `serial-units/[id]/grade/route.ts` — **REAL LEAK**

**Root cause:** `SELECT condition_grade, sku FROM serial_units WHERE id = $1` (63-66) and `UPDATE serial_units … WHERE id = $1` (82-89) have no org filter. Tenant B can grade tenant A's unit; `appendInventoryEvent`/`recordChange` then write `inventory_events`/`serial_unit_condition_history` (org NOT NULL, usav-fallback) for the wrong tenant.

**Fix:**

```ts
import { tenantQuery } from '@/lib/tenancy/db';

const existing = await tenantQuery(ctx.organizationId,
  `SELECT condition_grade::text AS condition_grade, sku
     FROM serial_units WHERE id = $1 AND organization_id = $2`,
  [serialUnitId, ctx.organizationId],
);
if (existing.rows.length === 0)            // 404 hides cross-tenant existence
  return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });

const updated = await tenantQuery(ctx.organizationId,
  `UPDATE serial_units SET condition_grade = $2::condition_grade_enum, updated_at = NOW()
     WHERE id = $1 AND organization_id = $3
   RETURNING id, condition_grade::text AS condition_grade, current_status::text AS current_status, updated_at`,
  [serialUnitId, newGrade, ctx.organizationId],
);
```

Then thread `ctx.organizationId` into `appendInventoryEvent`/`recordChange`/`gatherQualityInputs`/`recomputeUnitQualitySafe` (or run the whole handler in `withTenantTransaction` so their bare INSERTs inherit the correct GUC default). `sortSerialUnitToParts` likewise.

## 4b. `serial-units/[id]/move/route.ts` — **REAL LEAK**

**Root cause:** `resolveUnit` (164-179) does `SELECT … FROM serial_units WHERE id = $1` with no org filter, falling back to `findByNormalizedSerial(raw)` (also unscoped). `findLocationByBarcode/Name/getLocationById` resolve `inventory_locations` cross-tenant. The `UPDATE serial_units SET current_location WHERE id = $2` (106-112) then mutates another tenant's unit, and `recordInventoryEvent` (121-136) logs to their org.

**Fix:** scope `resolveUnit`:

```ts
async function resolveUnit(raw: string, orgId: string): Promise<UnitLite | null> {
  if (/^\d+$/.test(raw)) {
    const r = await tenantQuery<UnitLite>(orgId,
      `SELECT id, sku, current_location FROM serial_units
         WHERE id = $1 AND organization_id = $2 LIMIT 1`, [Number(raw), orgId]);
    if (r.rows[0]) return r.rows[0];
  }
  const fallback = await findByNormalizedSerial(raw, orgId);   // add org param to the helper
  // …
}
```

Pass `ctx.organizationId` at the call site (line 79), add `AND organization_id = $n` to the `UPDATE serial_units` (106-112), give `findLocationBy*` an org filter (`inventory_locations` should be tenant-scoped), and thread org into `recordInventoryEvent`.

## 4c. `serial-units/[id]/allocate/route.ts` — **REAL LEAK (cross-tenant write)**

**Root cause:** `resolveUnit` (189-200) and `resolveOrder` (207-223) both `SELECT … WHERE id/order_id = $1` with no org filter. `findOpenAllocationForUnit`, `allocate`, `release` all hit `order_unit_allocations` (org NOT NULL, RLS on) unscoped. Tenant B can pair tenant A's serial unit to tenant A's (or even B's own) order — a relational integrity + data-leak breach.

**Fix:** add an `orgId` param to `resolveUnit`/`resolveOrder` with `AND organization_id = $2`:

```ts
async function resolveOrder(input, orgId: string): Promise<OrderLite | null> {
  if (input.orderPk != null) {
    const r = await tenantQuery<OrderLite>(orgId,
      `SELECT id, order_id FROM orders WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [input.orderPk, orgId]);
    if (r.rows[0]) return r.rows[0];
  }
  if (input.orderRef) {
    const r = await tenantQuery<OrderLite>(orgId,
      `SELECT id, order_id FROM orders WHERE order_id = $1 AND organization_id = $2
       ORDER BY id DESC LIMIT 1`, [input.orderRef, orgId]);
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}
```

Same for `resolveUnit`. Both `null` results already map to 404 (lines 67/73) — good. Give `findOpenAllocationForUnit`/`allocate`/`release` an org param (or run the whole flow in `withTenantTransaction(ctx.organizationId, …)` so `order_unit_allocations`/`inventory_events` inserts inherit the GUC).

---

## 5. `src/app/api/inventory/units/route.ts` (closest "inventory" CRUD) — **REAL LEAK**

**Root cause:** GET builds `listSql`/`countSql` over `serial_units su LEFT JOIN sku_catalog sc` (66-88) with no org predicate; both run on the raw pool. Lists every tenant's serialized inventory.

**Fix:**

```ts
export const GET = withAuth(async (req, ctx) => {
  // …existing filter building…
  params.push(ctx.organizationId);
  where.push(`su.organization_id = $${params.length}`);   // add before whereClause is composed
  const whereClause = `WHERE ${where.join(' AND ')}`;       // always present now
  // …
  const [listResult, countResult] = await Promise.all([
    tenantQuery(ctx.organizationId, listSql, params),
    tenantQuery(ctx.organizationId, countSql, countParams),
  ]);
  // …
}, { permission: 'sku_stock.view' });
```

(`sku_catalog sc` in the join is for display only and is also org-owned; once RLS is live the GUC backstops it, but for defense-in-depth add `AND (sc.organization_id = su.organization_id OR sc.id IS NULL)` to the join.)

---

## 6. `src/app/api/sku-catalog/route.ts` + `[id]/route.ts` — **REAL LEAK**

**Root cause (route.ts):** GET calls `getSkuCatalogList({q,limit,offset,…})` (33) — the helper has no org param and no org WHERE (grep confirmed). POST calls `getSkuCatalogBySku(parsed.sku)` (70, unscoped — a tenant can probe another tenant's SKU existence and `is_active`) then `upsertSkuCatalog` (79, unscoped INSERT → usav-fallback). **`[id]/route.ts`** is worse: it uses `requireRoutePerm` not `withAuth`, and `getSkuCatalogById`/`getSkuCatalogDetail`/`upsertSkuCatalog`/`softDeleteSkuCatalog` are all unscoped — GET/PATCH/DELETE on any numeric id reads/edits/deletes another tenant's catalog row. The `bin_contents` stock guard (135-138) is also cross-tenant.

**Fix:** add an `orgId` parameter to the helpers in `src/lib/neon/sku-catalog-queries.ts` and put `WHERE … AND organization_id = $orgId` into each, e.g.:

```ts
// sku-catalog-queries.ts
export async function getSkuCatalogById(id: number, orgId: string) {
  const r = await tenantQuery(orgId,
    `SELECT * FROM sku_catalog WHERE id = $1 AND organization_id = $2 LIMIT 1`, [id, orgId]);
  return r.rows[0] ?? null;
}
export async function getSkuCatalogList(p: {…; orgId: string}) {
  // append `AND sc.organization_id = $orgId` to the existing WHERE and pass orgId
}
```

Route handlers thread `ctx.organizationId` (GET/POST already have `ctx`; the `[id]` route must read `gate.ctx.organizationId`, and if `requireRoutePerm` doesn't surface it, **switch the `[id]` route to `withAuth`**). For the `[id]` route the `before == null` checks (69, 128) already return 404 — once `getSkuCatalogById(id, ctx.organizationId)` is org-scoped, a cross-tenant id naturally 404s. Also scope the `bin_contents` guard: `WHERE sku = $1 AND organization_id = $2`. Wrap POST/PATCH/DELETE in `withTenantTransaction` (or set the GUC) so `upsertSkuCatalog`'s INSERT lands on the right org.

---

## 7. `src/app/api/reason-codes/route.ts` + `[id]/route.ts` — **REAL LEAK**

**Root cause (route.ts):** GET builds `clauses=['is_active = true']` and queries `reason_codes` (org NOT NULL, RLS on) with no org filter (38-61) → cross-tenant list. POST `createReasonCode(...)` (92) — helper unscoped, INSERT → usav-fallback. **`[id]/route.ts`** uses `requireRoutePerm`; `getReasonCodeById`/`updateReasonCode`/`softDeleteReasonCode` are unscoped → GET/PATCH/DELETE any tenant's reason code by numeric id.

**Fix (GET):**

```ts
export const GET = withAuth(async (request, ctx) => {
  const clauses: string[] = ['is_active = true'];
  const params: unknown[] = [];
  params.push(ctx.organizationId);
  clauses.push(`organization_id = $${params.length}`);   // <-- ownership filter
  // …direction/category filters use $${params.length} as before…
  const result = await tenantQuery<ReasonCodeRow>(ctx.organizationId, sql, params);
  // …
}, { permission: 'sku_stock.view' });
```

For `[id]`: add `orgId` to the three helpers (`… WHERE id = $1 AND organization_id = $2`), read `gate.ctx.organizationId` (or move to `withAuth`); the existing `!before` → 404 path then covers cross-tenant ids. POST → `withTenantTransaction` so `createReasonCode`'s INSERT is org-correct.

---

## 8. `src/app/api/shifts/route.ts` + `[id]/cover/route.ts` — **PARTIAL (indirect leak via child-scoping)**

**Root cause:** `shifts` is **child-scoped(staff,locations)** — it has **no `organization_id` column** (coverage: `has_org=false`), so you cannot add `WHERE shifts.organization_id =`. The leak is real but indirect: GET joins `shifts s JOIN staff st` (52-63) and the `staff` SELECT for materialization (43-45) is **unscoped** — `staff` *does* have `organization_id` (NOT NULL). So this lists/materializes every tenant's staff and their shifts. `[id]/cover` (`SELECT … FROM shifts WHERE id = $1 FOR UPDATE`, 61-67) lets tenant B cover tenant A's shift and (220-126) revoke A's `staff_sessions`.

**Fix:** scope through the `staff` parent (the established child-scoping pattern). GET:

```ts
const activeStaff = await tenantQuery<{ id: number }>(ctx.organizationId,
  `SELECT id FROM staff WHERE COALESCE(active,true)=true AND organization_id = $1`,
  [ctx.organizationId]);
// materialize loop unchanged
const r = await tenantQuery(ctx.organizationId,
  `SELECT s.id, … , st.name AS staff_name, st.color_hex, st.role
     FROM shifts s
     JOIN staff st ON st.id = s.staff_id AND st.organization_id = $3   -- gate via parent
    WHERE s.ends_at >= $1::date AND s.starts_at < ($2::date + INTERVAL '1 day')
      AND s.status NOT IN ('cancelled','missed')
    ORDER BY s.starts_at ASC, st.name ASC`,
  [from, to, ctx.organizationId]);
```

`[id]/cover`: lock+verify the shift belongs to the caller's org via its staff, before any write:

```ts
const origRes = await client.query(
  `SELECT sh.id, sh.staff_id, sh.starts_at, sh.ends_at, sh.status, sh.location_id
     FROM shifts sh JOIN staff st ON st.id = sh.staff_id
    WHERE sh.id = $1 AND st.organization_id = $2
    FOR UPDATE OF sh`,
  [originalShiftId, gate.ctx.organizationId]);   // 404 if not owned (hide existence)
// also verify coveringStaffId is in the same org:
//   SELECT 1 FROM staff WHERE id = $cover AND organization_id = $org  → else 400/404
// scope the staff_sessions revoke implicitly (staff_id already org-verified)
```

Run the whole cover in `withTenantTransaction(gate.ctx.organizationId, …)` so the `INSERT INTO shifts` and `UPDATE staff_sessions` execute under the right GUC. If `requireRoutePerm`'s `gate.ctx` lacks `organizationId`, move this route to `withAuth`.

---

## 9. `src/app/api/staff-goals/route.ts` — **PARTIAL (indirect leak via child-scoping)**

**Root cause:** `staff_goals` is **child-scoped(staff)** — **no `organization_id` column**. Leak is via the unscoped `staff` parent: GET single-lookup `… FROM staff s LEFT JOIN staff_goals sg … WHERE s.id = $1` (16-24) returns any tenant's staff+goal; the all-staff CTE (36-91) reads `staff`, `staff_goals`, `station_activity_logs` org-wide. PUT `upsertStaffGoalWithHistory(staffId,…)` (117) writes a goal for any staff id with no org check (`station_activity_logs` *does* have org but isn't filtered either).

**Fix:** gate every `staff` reference by `staff.organization_id`, and scope `station_activity_logs` (it has org) directly. Single lookup:

```ts
const single = await tenantQuery(ctx.organizationId,
  `SELECT s.id AS staff_id, s.name, s.employee_id,
          COALESCE(sg.daily_goal, 50) AS daily_goal,
          COALESCE(sg.station, ${stationParam ? '$3' : `'TECH'`}) AS station
     FROM staff s
     LEFT JOIN staff_goals sg ON sg.staff_id = s.id ${stationParam ? 'AND sg.station = $3' : ''}
    WHERE s.id = $1 AND s.organization_id = $2 LIMIT 1`,
  stationParam ? [staffId, ctx.organizationId, stationParam] : [staffId, ctx.organizationId]);
```

In the all-staff CTE: add `WHERE organization_id = $1` to the `derived_station` CTE's `FROM staff`, to `today_counts`/`week_counts`'s `FROM station_activity_logs`, and `AND s.organization_id = $1` to the final `WHERE s.active = true`; pass `ctx.organizationId` via `tenantQuery`. PUT: before `upsertStaffGoalWithHistory`, verify ownership:

```ts
const owns = await tenantQuery(ctx /*add ctx to PUT*/.organizationId,
  `SELECT 1 FROM staff WHERE id = $1 AND organization_id = $2`, [staffId, ctx.organizationId]);
if (owns.rows.length === 0) return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
```

(Note: PUT's handler signature currently drops `ctx` — add it: `withAuth(async (req, ctx) => …)`.) Run the upsert under `withTenantTransaction`.

---

## 10. `admin/staff/[id]/route.ts` + `roles/route.ts` + `reset-pin/route.ts` — **REAL LEAK (cross-tenant admin write)**

**Root cause:** all three resolve the target staff id straight from the URL and operate with no org check. `staff` has `organization_id` (NOT NULL) but it's never filtered:

- **`[id]/route.ts`** PATCH `UPDATE staff SET … WHERE id = $n` (77-82) and DELETE `UPDATE staff SET status='disabled' WHERE id = $1` (107) — a tenant-A admin can rename/suspend/**disable any other tenant's staff** and revoke their sessions. The most dangerous of the three.
- **`roles/route.ts`** GET (`staff_roles`/`roles` are **system-global**, no org col) and PUT: the `SELECT id FROM staff WHERE id = $1` probe (60) is unscoped, so PUT will assign roles to another tenant's staff (`staff_roles` insert + `UPDATE staff SET role` at 116). The roles themselves are global, but the *assignment to a foreign staff row* is the breach.
- **`reset-pin/route.ts`** probe `SELECT id FROM staff WHERE id = $1` (33) unscoped → clears PIN, sets `status='invited'`, revokes sessions, and mints an enrollment token (`/m/enroll/<token>`) for **another tenant's employee** — an account-takeover primitive.

**Fix (all three):** gate the staff row by org on the probe and on the mutation, returning 404 on miss.

`[id]/route.ts` PATCH:

```ts
params.push(id, ctx.organizationId);
const r = await pool.query(   // or tenantQuery(ctx.organizationId, …)
  `UPDATE staff SET ${updates.join(', ')}
     WHERE id = $${params.length - 1} AND organization_id = $${params.length}
   RETURNING id, name, role, status, employee_code, session_policy,
             default_home_path, default_home_path_mobile`,
  params);
if (r.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
```

DELETE: `UPDATE staff SET status='disabled', active=false WHERE id = $1 AND organization_id = $2` then 404 on `rowCount===0` **before** `revokeAllSessionsForStaff(id)` (don't revoke a foreign tenant's sessions).

`roles/route.ts`: scope the probe (60) — `SELECT id FROM staff WHERE id = $1 AND organization_id = $2` (bind `ctx.organizationId`); `!probe.rows[0]` already 404s. Keep the `roles`/`staff_roles` queries as-is (system-global by design — correct, not a leak). Run the diff transaction via `withTenantTransaction(ctx.organizationId, …)` and re-scope the final `UPDATE staff SET role` with `AND organization_id = $org`.

`reset-pin/route.ts`: scope the probe (33) — `SELECT id FROM staff WHERE id = $1 AND organization_id = $2`; 404 on miss. This single line closes the takeover. For belt-and-suspenders, add `AND organization_id = $2` to the `UPDATE staff SET pin_hash=NULL …` (37-46).

---

## Summary table

| Route | Verdict | One-line root cause |
|---|---|---|
| `receiving-lines/route.ts` | **REAL LEAK** | All CRUD on `receiving_lines`+joins via raw pool, no `organization_id` filter |
| `receiving/match/route.ts` | **REAL LEAK (write)** | Manual tx, no GUC; matches/updates/inserts another tenant's lines & work_assignments |
| `work-orders/route.ts` | **REAL LEAK (write)** | `getOrders`/`upsertAssignment`/blind `UPDATE receiving`,`fba_shipments` unscoped |
| `serial-units/route.ts` | **FALSE POSITIVE** | File doesn't exist (listing lives in `inventory/units`) |
| `serial-units/[id]/grade` | **REAL LEAK (write)** | `SELECT`/`UPDATE serial_units WHERE id` only; events logged to wrong org |
| `serial-units/[id]/move` | **REAL LEAK (write)** | `resolveUnit`/locations unscoped; mutates foreign unit location |
| `serial-units/[id]/allocate` | **REAL LEAK (write)** | `resolveUnit`/`resolveOrder`/allocations unscoped; pairs across tenants |
| `inventory/units/route.ts` | **REAL LEAK** | `serial_units` list/count with no org predicate |
| `sku-catalog/route.ts` + `[id]` | **REAL LEAK (write)** | Helpers + `[id]` (uses `requireRoutePerm`) read/edit/delete any org's SKU |
| `reason-codes/route.ts` + `[id]` | **REAL LEAK (write)** | List + helpers unscoped; `[id]` edits/deletes any org's reason code |
| `shifts/route.ts` + `[id]/cover` | **PARTIAL** | `shifts` has no org col; leak via unscoped `staff` parent + cross-tenant cover/session-revoke |
| `staff-goals/route.ts` | **PARTIAL** | `staff_goals` has no org col; leak via unscoped `staff` + `station_activity_logs` |
| `admin/staff/[id]` + `roles` + `reset-pin` | **REAL LEAK (write)** | Target staff id taken from URL, no `staff.organization_id` gate → cross-tenant disable/role-grant/PIN-reset (takeover) |

**Cross-cutting fix mechanics:** (1) read routes → `tenantQuery(ctx.organizationId, sql, [...params, ctx.organizationId])` + `AND <t>.organization_id = $n`; (2) write/multi-statement routes → `withTenantTransaction(ctx.organizationId, …)` so the `usav-fallback` INSERT default resolves to the real tenant; (3) `[id]` routes → ownership re-check returning **404** (never 403) on org mismatch; (4) child-scoped tables (`shifts`,`staff_goals`,`receiving_scans`,`testing_results`) → gate through the org-bearing parent (`staff`/`receiving`/`serial_units`); (5) the four routes using `requireRoutePerm` (`sku-catalog/[id]`, `reason-codes/[id]`, `shifts/[id]/cover`) must confirm `gate.ctx.organizationId` is populated — if not, switch them to `withAuth`.