# Auth + Audit Coverage Inventory (Phase 0)

Baseline snapshot of where the codebase stands against the steady-state model defined in `src/lib/auth/MIGRATION_GUIDE.md`. Every later phase ticks rows in this document off.

**Snapshot date:** 2026-05-17
**Method:** static analysis of `src/app/api/**/route.ts`, `src/app/**/page.tsx`, and `src/lib/auth/*`. No runtime data.

---

## Executive numbers

| Dimension | Count | % | Notes |
|---|---|---|---|
| Total API route files | ~250 | — | `src/app/api/**/route.ts` |
| Total exported method handlers | ~463 | — | GET/POST/PUT/PATCH/DELETE across all routes |
| Handlers wrapped in `withAuth(...)` | ~35 (29 files) | **~7.5%** | almost exclusively `/admin/*` + `/audit-log/*` |
| Handlers with a `permission:` string declared | 33 | **~7%** | see "Permission vocabulary actually wired" below |
| Handlers with `stepUp: true` | **1** | **~0.2%** | only `admin/staff/[id]/set-pin` |
| Mutation routes (INSERT / UPDATE / DELETE SQL) | 101 files | — | the "must audit" denominator |
| Mutation routes that call `recordAudit` or `createAuditLog` | **10 files** | **~10%** | huge gap |
| Routes that read `body.staffId / staff_id / techId / packerId` | **39 files** | — | trust-the-client identity, must move to `ctx.staffId` |
| Routes that read URL `?staffId= / techId= / packerId=` | **16 files** | — | mix of identity + admin-filter; identity to move to `ctx`, filter stays |
| Total page files (`page.tsx`) | 43 | — | |
| Pages calling `requirePermission` or `getCurrentUser` | **7** | **~16%** | the rest rely on proxy-level cookie check only |
| Permission strings defined in `permissions.ts` | 60+ | — | full vocab |
| Permission strings actually wired to a route | **5** | **~8%** | `admin.manage_staff`, `admin.manage_roles`, `admin.view_logs`, `admin.view_sessions`, `admin.manage_features` |

**Headline:** the auth scaffolding is built end-to-end (proxy gate, session cookie, `withAuth` wrapper, RBAC vocab, two audit tables, step-up scaffolding) — but in production it's only enforced on admin endpoints. ~93% of routes still operate on the legacy "trust the client" model.

---

## 1. Route coverage matrix (sorted by feature area)

Legend: ✅ wired · ⚠️ partial · ❌ missing · ⛔ trust-client identity

| Feature area | Routes | `withAuth` | `permission:` | `recordAudit` | Reads `staffId` from client | Notes |
|---|---:|:---:|:---:|:---:|:---:|---|
| **Admin (`/api/admin/**`)** | ~22 | ✅ all | ✅ all | ❌ none | ❌ none | The gold standard — already on the new model. Only one (`admin/staff/[id]/set-pin`) wires `stepUp:true`. |
| **Audit-log (`/api/audit-log/**`)** | 7 | ✅ all | ✅ `admin.view_logs` | n/a (read-only) | ❌ | Fully migrated. |
| **Auth (`/api/auth/**`)** | ~15 | ❌ direct | n/a (own gate) | ❌ none | ❌ | signin/pin/passkey routes implement their own auth flow; correct. `auth/switch` and `auth/staff-picker` need review. |
| **Receiving (`/api/receiving/**`)** | ~12 | ⚠️ 2/12 | ❌ 0/12 | ⚠️ 2/12 | ⛔ many | Only `mark-received` + `mark-received-po` are wrapped — but with NO `permission:` set; just session check. Other routes still read `body.staffId`/`body.unboxedBy`/etc. |
| **Receiving-lines / receiving-photos / receiving-tasks / receiving-entry / receiving-logs** | ~8 | ❌ none | ❌ none | ⚠️ a few | ⛔ all | Sibling tables to /receiving; same gap. |
| **Packing (`/api/packing-logs/**`, `/api/packerlogs`)** | ~9 | ❌ none | ❌ none | ⚠️ packing-logs, packerlogs (2) | ⛔ all | Critical for "who packed this order" attribution — currently all client-supplied. |
| **Tech (`/api/tech/**`)** | ~14 | ❌ none | ❌ none | ⚠️ tech/scan, tech/serial (2) | ⛔ most | Same model: client sends techId. |
| **Tech-logs (`/api/tech-logs/**`)** | ~3 | ❌ | ❌ | ❌ | ⛔ | `?techId=` for "give me my logs" — identity should come from session. |
| **Orders (`/api/orders/**`)** | ~14 | ❌ none | ❌ none | ⚠️ orders/assign | ⛔ many | High-value verbs (delete, void, integrity-check, missing-parts) have NO permission check. |
| **Shipping (`/api/shipping/**`, `/api/shipped/**`)** | ~9 | ❌ | ❌ | ❌ | ⛔ | `shipping.mark_shipped`, `shipping.void_order` permission strings defined but unused. |
| **FBA (`/api/fba/**`)** | ~28 | ❌ none | ❌ none | ⚠️ ~6 routes | ⛔ many | Largest single feature area on the legacy model. Includes scan-fnsku, logs POST/DELETE, shipments mark-shipped, items scan, labels bind. |
| **SKU stock / SKU catalog (`/api/sku-stock/**`, `/api/sku/**`, `/api/sku-catalog/**`)** | ~16 | ⚠️ 1 (`sku-stock/[sku]`) | ❌ none | ⚠️ 1 (`sku-stock/[sku]`) | ⛔ some | Inventory mutations mostly un-gated. |
| **Locations / Bins (`/api/locations/**`, `/api/rooms/**`)** | ~7 | ❌ none | ❌ none | ⚠️ locations (3) | ⛔ | Bin verbs like rename/swap/remove are step-up-eligible per `STEP_UP_PERMISSIONS` but no route uses them yet. |
| **Replenish + Cycle counts** | ~5 | ❌ | ❌ | ❌ | ⛔ | `replenish.approve_po`, `cycle_count.approve` step-up perms defined but unused. |
| **Work orders + Walk-in + Repair** | ~14 | ❌ | ❌ | ❌ | ⛔ | All on legacy model. |
| **Staff (`/api/staff/**`)** | ~7 | ❌ none | ❌ none | ❌ none | ⛔ | `staff/schedule/**` and `staff/availability-rules` mutate scheduling without permission gates. |
| **Assignments (`/api/assignments/**`)** | 4 | ❌ | ❌ | ❌ | ⛔ | Identity-style `?staff_id=` for "my next assignment" — should derive from session. |
| **Staff-goals (`/api/staff-goals`)** | 2 | ❌ | ❌ | ❌ | ⛔ | Mix of self-lookup (identity) and admin-edit (PUT — no permission). |
| **Integrations (`/api/zoho/**`, `/api/ebay/**`, `/api/ecwid/**`, `/api/ecwid-square/**`)** | ~18 | ❌ | ❌ | ❌ | n/a | Server-to-server — needs `allowAnonymous:true` + API-key or HMAC gate, neither present today. |
| **Qstash schedulers / Webhooks (`/api/qstash/**`, `/api/webhooks/**`, `/api/cron/**`)** | ~14 | ❌ | n/a | ❌ | n/a | Webhook signature verification is the right model here; check each one has it. |
| **Dashboards / Reports / Stats** | ~10 | ❌ | ❌ | n/a (read) | n/a | Currently anyone signed-in can view — should be gated by `dashboard.view` / `reports.view`. |
| **Diagnostics / Setup (`/api/db/ping`, `/api/setup-db`, `/api/drizzle-setup`, `/api/diagnose-migration`, `/api/migrate-process`, `/api/setup-source-db`)** | ~7 | ❌ | ❌ | n/a | n/a | **🚨 destructive endpoints accessible to any signed-in user.** `setup-db` recreates tables. Must be admin-only or removed. |
| **Misc readers (`/api/sku/`, `/api/manuals/`, `/api/product-manuals/`, `/api/manual-server/`, `/api/inventory/`, `/api/inventory-events`, `/api/inventory-photos`, `/api/check-tracking`, `/api/debug-tracking`, `/api/activity/feed`, `/api/architecture`, `/api/ai/**`, `/api/repair-service/**`)** | ~30 | ❌ | ❌ | varies | varies | Mostly fine as authenticated-only reads, but should still declare an explicit permission for defense in depth. |

---

## 2. Routes wrapped in `withAuth` today (29 files / ~35 handlers)

These are the only routes currently enforcing role-based access:

| Route | Methods | Permission | StepUp |
|---|---|---|---|
| `admin/audit` | GET | `admin.view_logs` | ❌ |
| `admin/roles` | GET, POST | `admin.manage_roles` | ❌ |
| `admin/roles/[id]` | GET, PATCH, DELETE | `admin.manage_roles` | ❌ |
| `admin/roles/[id]/duplicate` | POST | `admin.manage_roles` | ❌ |
| `admin/roles/reorder` | PATCH | `admin.manage_roles` | ❌ |
| `admin/sessions` | GET | `admin.view_sessions` | ❌ |
| `admin/sessions/[sid]` | DELETE | `admin.view_sessions` | ❌ |
| `admin/staff` | GET, POST | `admin.manage_staff` | ❌ |
| `admin/staff/reorder` | PATCH | `admin.manage_staff` | ❌ |
| `admin/staff/[id]` | PATCH, DELETE | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/detail` | GET | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/enroll-token` | POST | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/passkeys` | GET | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/passkeys/[pid]` | DELETE | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/permissions` | PATCH | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/reset-pin` | POST | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/roles` | GET, PUT | `admin.manage_staff` | ❌ |
| `admin/staff/[id]/sessions` | GET, DELETE | `admin.view_sessions` | ❌ |
| `admin/staff/[id]/set-pin` | POST | `admin.manage_staff` | ✅ |
| `audit-log/packing` | GET | `admin.view_logs` | ❌ |
| `audit-log/receiving` | GET | `admin.view_logs` | ❌ |
| `audit-log/report` | GET | `admin.view_logs` | ❌ |
| `audit-log/sku` | GET | `admin.view_logs` | ❌ |
| `audit-log/staff` | GET | `admin.view_logs` | ❌ |
| `audit-log/staff-directory` | GET | `admin.view_logs` | ❌ |
| `audit-log/tech` | GET | `admin.view_logs` | ❌ |
| `receiving/mark-received` | POST | ⚠️ NONE | ❌ |
| `receiving/mark-received-po` | POST | ⚠️ NONE | ❌ |
| `sku-stock/[sku]` | PATCH | ⚠️ NONE | ❌ |

**Observation:** The three non-admin routes (`receiving/mark-received`, `receiving/mark-received-po`, `sku-stock/[sku]`) are wrapped in `withAuth` but pass NO `permission:` option — they just confirm the caller is authenticated. They should declare `receiving.mark_received` / `sku_stock.adjust` respectively.

---

## 3. Mutation routes that call `recordAudit` / `createAuditLog` (10 of 101)

| Route | Audit verb |
|---|---|
| `sku-stock/[sku]` | sku_stock.adjust + bin assigns |
| `receiving/mark-received` | po.receive |
| `receiving/mark-received-po` | po.receive |
| `locations/[barcode]/swap` | bin.swap |
| `locations/route.ts` (POST) | bin.create / bin.rename |
| `locations/[barcode]/route.ts` (PATCH) | bin.rename / bin.move |
| `packing-logs/route.ts` (POST) | PACK_COMPLETED |
| `packerlogs/route.ts` (POST) | PACK_COMPLETED |
| `packing-logs/update/route.ts` | pack_log.update |
| `orders/assign/route.ts` (POST) | order.assign |

**91 mutation routes write zero audit_logs rows today.** That's the single biggest gap.

---

## 4. Routes reading identity from request body (39 files)

(Identity-from-client — needs to migrate to `ctx.staffId` via `withAuth`. Pattern: `body.staffId | body.staff_id | body.techId | body.tech_id | body.packerId | body.packer_id`.)

Receiving cluster:
- `receiving/mark-received`, `mark-received-po` (already withAuth — handler still reads body for legacy compat; drop)
- `receiving/scan-serial`, `receiving/serials`, `receiving/lookup-po`, `receiving/match`
- `receiving/lines/[id]/move`, `receiving/lines/[id]/putaway`, `receiving/lines/[id]/status`
- `receiving-lines/route.ts`, `receiving-entry/route.ts`, `receiving-logs/route.ts`, `receiving-photos/route.ts`, `receiving-tasks/route.ts`

Tech cluster:
- `tech/scan`, `tech/scan-sku`, `tech/scan-tracking`, `tech/scan-repair-station`, `tech/scan-fnsku`
- `tech/add-serial`, `tech/add-serial-to-last`, `tech/update-serials`, `tech/undo-last`, `tech/delete`, `tech/delete-tracking`
- `tech/serial`, `tech/logs`, `tech/orders-without-manual`
- `tech-logs/route.ts`, `tech-logs/update/route.ts`, `tech-logs/search/route.ts`

Packing cluster:
- `packing-logs` (GET/POST/PUT/DELETE), `packing-logs/update`, `packing-logs/start-session`, `packing-logs/save-photo`, `packing-logs/history`, `packing-logs/details`, `packing-logs/photos`, `packing-logs/last-order`
- `packerlogs` (GET/POST/PUT/DELETE)

FBA cluster:
- `fba/scan-fnsku`, `fba/logs` (POST), `fba/logs/[id]` (DELETE)
- `fba/shipments/[id]/items` (POST), `fba/shipments/[id]/items/[itemId]` (PATCH/DELETE)
- `fba/shipments/[id]/tracking` (POST/PATCH/DELETE), `fba/shipments/split-for-paired-review`
- `fba/items/scan`, `fba/items/verify`, `fba/items/ready`, `fba/labels/bind`
- `fba/shipments/mark-shipped`, `fba/shipments/close`

Inventory + locations + sku catalog:
- `sku-stock/[sku]` (PATCH — wrapped but still reads body)
- `locations/[barcode]`, `locations/[barcode]/swap`, `locations/route.ts` (POST)
- `transfers/route.ts`, `update-sku-location/route.ts`
- `inventory-photos/route.ts`
- `cycle-counts/lines/[id]`, `cycle-counts/campaigns/[id]`, `cycle-counts/campaigns/route.ts`
- `sku/[id]/photos`, `sku-catalog/pair/route.ts`, `sku-catalog/run-migration`, `sku-catalog/sync-ecwid-products`, `sku-manager`

Staff scheduling:
- `staff/schedule/week`, `staff/schedule/route.ts`, `staff/schedule/bulk`, `staff/availability-rules`

Other:
- `staff-goals` (PUT body.staffId — admin-edit)
- `favorites/[id]`, `favorites/route.ts`
- `admin/features/route.ts`, `admin/features/[id]/route.ts`
- `assignments/sku-search`
- `scan-tracking/route.ts`

---

## 5. Routes reading identity from URL search params (16 files)

| Route | Param | Classification |
|---|---|---|
| `assignments/next` | `staff_id \| assigned_tech_id \| assigned_packer_id` | Identity — drop, use `ctx.staffId` |
| `assignments/sku-search` | `staff_id` | Filter — keep, gate behind permission |
| `assignments/route.ts` | varies | TBD per method |
| `tech/logs` | `techId` | Identity (own) — drop |
| `tech/scan-fnsku` | `techId` | Identity — drop |
| `tech/orders-without-manual` | `techId` | Identity — drop |
| `fba/scan-fnsku` | `staffId \| techId` | Identity — drop |
| `fba/logs` (GET) | `staff_id` | Filter — keep |
| `fba/logs/[id]` (DELETE) | `staff_id` | Identity — drop |
| `packing-logs/route.ts` | `packerId` | Identity (own) — drop |
| `packerlogs/route.ts` | `packerId` | Identity (own) — drop |
| `orders/next` | `techId` | Identity — drop |
| `repair-service/next` | `techId` | Identity — drop |
| `staff-goals` (GET) | `staffId` | Mixed: self-lookup → drop; admin-cross → keep behind permission |
| `staff/availability-rules` (GET) | `staffId` | Filter — keep |
| `admin/audit` | `staffId` | Filter — keep (already gated) |

---

## 6. Permission vocabulary: defined vs. wired

`src/lib/auth/permissions-shared.ts` defines **60+ permission strings across 9 categories**. Of those, **only 5 are currently wired to a route**:

| Wired ✅ | Defined but never wired ❌ |
|---|---|
| `admin.view_logs` | `dashboard.view`, `operations.view`, `reports.view`, `reports.export` |
| `admin.view_sessions` | `receiving.view`, `receiving.scan_po`, `receiving.mark_received`, `receiving.upload_photo`, `receiving.bin_assign` |
| `admin.manage_staff` | `packing.view`, `packing.start_session`, `packing.scan_order`, `packing.print_label`, `packing.complete_order` |
| `admin.manage_roles` | `tech.view`, `tech.scan_serial`, `tech.qc_pass`, `tech.qc_fail`, `tech.assign_bin` |
| `admin.manage_features` | `repair.view`, `repair.intake`, `repair.mark_repaired` |
| | `shipping.view`, `shipping.mark_shipped`, `shipping.void_order` |
| | `orders.view`, `orders.create`, `orders.void` |
| | `fba.view`, `fba.manage_fnskus`, `fba.stage_shipments` |
| | `sku_stock.view`, `sku_stock.adjust`, `sku_stock.manage` |
| | `bin.adjust`, `bin.set`, `bin.rename`, `bin.swap`, `bin.remove`, `bin.add_sku` |
| | `cycle_count.view`, `cycle_count.approve` |
| | `replenish.view`, `replenish.create_po`, `replenish.approve_po` |
| | `work_orders.view`, `work_orders.claim`, `work_orders.complete` |
| | `walk_in.view`, `walk_in.intake` |
| | `print.label`, `print.silent` |
| | `integrations.zoho`, `integrations.ebay`, `integrations.ecwid` |
| | `settings.workstation`, `settings.hardware` |
| | `admin.view` |

The matrix of role → permission set is fully populated in `permissions-shared.ts:78-122`. Wiring is just route-side.

---

## 7. Step-up coverage

`STEP_UP_PERMISSIONS` (defined in `permissions-shared.ts:69-74`):
- `shipping.void_order`, `orders.void`
- `bin.remove`, `bin.swap`
- `cycle_count.approve`, `replenish.approve_po`
- `admin.manage_staff`, `admin.manage_roles`, `admin.manage_features`

Wired with `stepUp: true` on a route: **`admin/staff/[id]/set-pin` only.**

Note: `withAuth` automatically requires step-up when the route's `permission:` is in `STEP_UP_PERMISSIONS` (`withAuth.ts:96`), so the explicit `stepUp:true` flag is only needed for routes whose verb isn't already on the list. Since none of the step-up perms are wired to routes yet, step-up is essentially dormant.

**Sensitive verbs missing from `STEP_UP_PERMISSIONS` that probably belong:**
- Any `staff.set_pin` / `staff.reset_pin` (handled today by `admin.manage_staff` step-up, fine)
- `integrations.*` credential rotate paths
- `sku_stock.adjust` (large adjustments)

---

## 8. Page guard inventory (7 of 43 pages)

Pages calling `requirePermission` or `getCurrentUser`:

| Page | Method |
|---|---|
| `app/tech/page.tsx` | `getCurrentUser` |
| `app/packer/page.tsx` | `getCurrentUser` |
| `app/audit-log/packing/page.tsx` | `requirePermission` |
| `app/audit-log/receiving/page.tsx` | `requirePermission` |
| `app/audit-log/sku/page.tsx` | `requirePermission` |
| `app/audit-log/staff/page.tsx` | `requirePermission` |
| `app/audit-log/tech/page.tsx` | `requirePermission` |

**The remaining 36 pages have no server-side permission check.** They rely on the proxy's cookie-presence gate plus the AuthContext client-side fallback redirect. That's sufficient for "authenticated only" but doesn't enforce role.

High-value pages with no guard today:
- `/admin/page.tsx` ⚠️ admin console
- `/dashboard/page.tsx`
- `/operations/page.tsx`
- `/settings/page.tsx`
- `/receiving/page.tsx`, `/receiving/lines/[id]/page.tsx`
- `/fba/page.tsx`
- `/inventory/page.tsx`
- `/sku-stock/page.tsx`, `/sku-stock/[sku]/page.tsx`, `/sku-stock/location/[barcode]/page.tsx`
- `/walk-in/page.tsx`, `/repair/page.tsx`
- `/work-orders/page.tsx`
- `/replenish/page.tsx`
- `/reports/page.tsx`, `/previous-quarters/page.tsx`
- `/tracking-exceptions/page.tsx`
- `/manuals/page.tsx`
- `/ai/page.tsx`, `/support/page.tsx`
- `/bin/[barcode]/page.tsx`, `/serial/[id]/page.tsx`
- `/m/r/[id]/page.tsx`, `/m/r/[id]/photos/page.tsx`, `/m/b/[barcode]/page.tsx`, `/m/scan/page.tsx`
- `/01/[gtin]/page.tsx`, `/01/[gtin]/21/[serial]/page.tsx`
- `/audit-log/page.tsx`

`/admin/page.tsx` having no `requirePermission('admin.view')` is the most concerning — admin UI is reachable by any signed-in user, even if the API routes behind it are gated. Defense in depth missing.

---

## 9. Baseline metric SQL (run on prod or staging)

These produce the "before" numbers we'll re-run after each phase to measure progress.

### 9.1 — Audit row volume per day, last 30 days
```sql
SELECT
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS rows,
  COUNT(DISTINCT actor_staff_id) AS distinct_actors,
  COUNT(DISTINCT action) AS distinct_actions
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

### 9.2 — `auth_audit` event distribution, last 30 days
```sql
SELECT
  event,
  result,
  COUNT(*) AS n
FROM auth_audit
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY event, result
ORDER BY n DESC;
```

### 9.3 — Permission denials per route per day
```sql
SELECT
  detail->>'path' AS path,
  detail->>'permission' AS permission,
  DATE_TRUNC('day', created_at) AS day,
  COUNT(*) AS denials
FROM auth_audit
WHERE event = 'permission.denied'
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY day DESC, denials DESC;
```

### 9.4 — Mutation actions written to `audit_logs`, last 30 days
```sql
SELECT
  action,
  entity_type,
  source,
  COUNT(*) AS n,
  COUNT(DISTINCT actor_staff_id) AS distinct_actors,
  COUNT(*) FILTER (WHERE actor_staff_id IS NULL) AS null_actor_rows
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY n DESC;
```

Watch `null_actor_rows` — rows with `actor_staff_id IS NULL` are exactly the ones written by routes that don't have a proper auth context yet (client-supplied identity that failed to round-trip). Phase 3 should drive this column to 0.

### 9.5 — Signin failure rate per IP per hour (brute-force surface)
```sql
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  ip,
  COUNT(*) FILTER (WHERE result = 'denied') AS denied,
  COUNT(*) AS attempts
FROM auth_audit
WHERE event IN ('signin.pin', 'signin.passkey')
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1, 2
HAVING COUNT(*) FILTER (WHERE result = 'denied') > 0
ORDER BY denied DESC, attempts DESC;
```

### 9.6 — Active sessions by device kind
```sql
SELECT
  device_kind,
  COUNT(*) AS sessions,
  COUNT(DISTINCT staff_id) AS distinct_staff,
  MIN(created_at) AS oldest,
  MAX(last_seen_at) AS newest
FROM staff_sessions
WHERE expires_at > NOW()
GROUP BY 1
ORDER BY sessions DESC;
```

### 9.7 — Step-up usage, last 30 days
```sql
SELECT
  scope,
  COUNT(*) AS grants,
  COUNT(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed,
  COUNT(DISTINCT staff_id) AS distinct_staff
FROM staff_stepups
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY grants DESC;
```

---

## 10. Gap-closure priorities (input into Phases 1–6)

Ordered by risk × ease:

1. **🚨 P0 — Lock down `/api/setup-db`, `/api/setup-source-db`, `/api/drizzle-setup`, `/api/migrate-process`, `/api/diagnose-migration`** behind `admin.manage_features` + `stepUp:true`, or delete them if they're dev-only. Today any signed-in staff can recreate the schema.
2. **P0 — Wire `permission:` on the 3 non-admin routes already using `withAuth`** (`receiving/mark-received`, `receiving/mark-received-po`, `sku-stock/[sku]`). One-line change each, immediate enforcement.
3. **P0 — `/admin/page.tsx` `requirePermission('admin.view')`** — defense in depth for the admin UI.
4. **P1 — Receiving feature area** (Phase 3 area #1 per MIGRATION_GUIDE): wrap all 12 receiving routes, drop body.staffId reads. Largest single-area mutation surface after FBA.
5. **P1 — FBA feature area**: 28 routes, including step-up-eligible `mark-shipped` and `close`. Big surface; one PR per sub-area.
6. **P1 — Packing + Tech + Tech-logs**: 26 routes, all on legacy model. Identity migration here cleans up the catalog from the prior turn (DashboardSidebar tech identity, etc).
7. **P2 — Audit completeness**: extend `withAuth` with `audit:` option, then audit-floor every mutation route discovered above.
8. **P2 — Step-up wiring** for `bin.remove`, `bin.swap`, `shipping.void_order`, `orders.void`, `cycle_count.approve`, `replenish.approve_po`.
9. **P2 — Page-guard rollout**: ~36 unguarded pages. Bulk-add `requirePermission` calls; failing pages reveal additional permission strings to add.
10. **P3 — Integrations**: webhook signature verification + API-key gate on `zoho/*`, `ebay/*`, `ecwid/*`, `qstash/*`, `webhooks/*`.
11. **P3 — Drop shadow-mode branches** in `withAuth.ts` and `page-guard.ts` (covered in Phase 1 of the master plan).
12. **P3 — Diagnostics + dashboards**: gate behind `dashboard.view` / `operations.view` / `reports.view`.

---

## 11. What's NOT a gap

These already conform to the standard pattern, no action required:
- `auth/signin`, `auth/pin/*`, `auth/passkey/*`, `auth/signout`, `auth/session` — auth-flow routes that correctly handle their own gates.
- `audit-log/*` GET endpoints — wrapped with `admin.view_logs`.
- All `admin/*` routes — wrapped with the right permission, just missing `stepUp:true` on a few destructive ones (passkey delete, session revoke, role delete).
- `proxy.ts` — enforces by default for HTML + API (modulo `AUTH_V2_ENABLED` shadow toggle, which Phase 1 removes).
- `withAuth.ts` framework itself — solid implementation.
- `recordAudit` helper — correct shape, pulls actor from ctx; just under-used.
- `permissions-shared.ts` vocabulary — comprehensive; the gap is wiring, not vocabulary.

---

*Next:* Phase 1 — perimeter hardening. Strip shadow-mode branches, narrow `ctx.staffId` types, add security headers. ~1 day work.
