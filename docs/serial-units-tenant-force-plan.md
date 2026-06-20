# serial_units — Production Multi-Tenant (FORCE RLS) Readiness Plan

**Status:** per-org natural key DONE; FORCE RLS deferred pending writer threading.
**Owner:** _you_
**Template:** mirrors the proven receiving-core wave (`2026-06-19_enforce_tenant_isolation_receiving_core.sql`) and packer/tech wave (`2026-06-20_enforce_tenant_isolation_packer_tech.sql`).
**Rollback at any point:** `select relax_tenant_isolation('serial_units');`

---

## 1. Where we are

| Aspect | State |
|---|---|
| `organization_id` | **NOT NULL**, 0 NULL rows ✓ |
| Natural key | **Per-org** ✓ — `ux_serial_units_org_normalized_serial (organization_id, normalized_serial)` (global `serial_units_normalized_uniq` dropped, `2026-06-19_serial_units_org_scoped_unique.sql`) |
| RLS | **ENABLED + policy** (`serial_units_tenant_isolation`) but **NOT FORCED** |
| Reads | 35/51 read sites already go through `tenantQuery`/`withTenantConnection` (app_tenant + GUC); the other 16 use the owner pool (BYPASSRLS) → unaffected by FORCE |
| Writes | **The blocker** — see §2 |

**Why FORCE is the last step:** `enforce_tenant_isolation('serial_units')` does three things — (a) flips the `organization_id` default from the USAV-fallback to **loud-fail** (`NULLIF(current_setting('app.current_org'),'')::uuid`), (b) `FORCE ROW LEVEL SECURITY`, (c) re-asserts the policy. (b) is inert for the owner (`neondb_owner` has BYPASSRLS) but **live for `app_tenant`** (the role `tenantPool`/`withTenantConnection` uses). (a) is active for **every** role immediately. So any writer that neither stamps `organization_id` nor runs with the `app.current_org` GUC set will start failing `NOT NULL`.

---

## 2. The core blocker: `upsertSerialUnit` scoped/unscoped duality

`src/lib/neon/serial-units-queries.ts`:
```ts
export async function upsertSerialUnit(
  input: UpsertSerialUnitInput,
  options?: UpsertSerialUnitOptions,
  orgId?: OrgId,            // ← optional today
): Promise<UpsertSerialUnitResult | null>
```
- **Scoped path** (`orgId` provided): SELECT…FOR UPDATE is org-pinned, INSERT stamps `organization_id` (line ~563). Safe under FORCE.
- **Unscoped path** (`orgId` omitted): raw INSERT (line ~596) relying on the column **default**. Under FORCE + loud-fail default, this **only works if the executing client has the GUC set** (i.e. runs inside `withTenantConnection`/`withTenantTransaction`). On the bare owner `pool`, it throws `NOT NULL`.

**Decision: make `orgId` required and delete the unscoped path.** This removes the footgun permanently and also fixes a latent correctness bug (the unscoped `SELECT … FOR UPDATE WHERE normalized_serial = $1` is *not* org-filtered, so with ≥2 tenants it can lock/return another tenant's unit).

---

## 3. Writer inventory (exact sites + action)

### 3a. Direct `INSERT INTO serial_units` — already done, just confirm
| Site | Status |
|---|---|
| `src/app/api/receiving/mark-received/route.ts:133` (fallback) | ✓ stamps `organization_id` |
| `src/lib/neon/serial-units-queries.ts:563` (scoped) | ✓ stamps |
| `src/lib/neon/serial-units-queries.ts:596` (unscoped) | ✗ **delete in Phase 1** |
| `src/lib/tech/insertTechSerialForTracking.ts:45` | ✓ stamps |

### 3b. `upsertSerialUnit` callers — thread `orgId`
| Caller | Connection | Today | Action |
|---|---|---|---|
| `src/app/api/post-multi-sn/route.ts:157` | bare `pool` | unscoped → **breaks** | Pass `ctx.organizationId` as 3rd arg (route is `withAuth`, has `ctx`) |
| `src/app/api/receiving/mark-received/route.ts:497` | bare `pool` | unscoped → **breaks** | Pass `ctx.organizationId` as 3rd arg |
| `src/lib/receiving/serial-attach.ts:169, 289` | `withTenantTransaction(orgId)` (GUC set) | GUC-safe but unscoped | Pass the in-scope `orgId` as 3rd arg (correctness + drops the cross-tenant lock risk) |
| `src/lib/receiving/receive-line.ts:307` | `{ dbClient: client }` | **verify** client origin | Confirm `client` comes from `withTenantTransaction`; thread `orgId` param into `receive-line` and pass as 3rd arg |
| `src/lib/neon/serial-units-queries.ts:800, 903` | internal helpers | pass `orgId` through | These already receive/forward `orgId` (903 calls `…, undefined, orgId`); make them require it |
| `src/lib/inventory/unit-events.ts:105` | — | **test-only** (`recordUnitEvent` has no prod callers) | Thread `organizationId` through `RecordUnitEventInput` for test-correctness; not a prod FORCE risk |

> Net new work is small: **2 hard breakers** (`post-multi-sn`, `mark-received`) + making `orgId` required + deleting the unscoped branch. The rest are already GUC-wrapped or test-only.

### 3c. Read path — no change needed
35 read sites use `tenantQuery`/`withTenantConnection` (GUC=org → FORCE returns the org's rows). The 16 owner-pool readers bypass FORCE. **Do not** convert owner-pool reads to tenantPool as part of this work — that's a separate, broader migration and not required for FORCE safety (single-tenant today; GUC always = USAV).

---

## 4. Step-by-step

### Phase 1 — Make `orgId` required (1 file)
1. In `serial-units-queries.ts`, change the signature to `orgId: OrgId` (required) and **delete the unscoped branch** (the `scoped ? … : …` fork → keep only the scoped SQL). The SELECT…FOR UPDATE keeps `AND organization_id = $orgId`.
2. `tsc` will now flag every caller missing the 3rd arg — that's your worklist.

### Phase 2 — Thread `orgId` through callers (§3b)
3. Fix each compile error by passing the in-scope org (`ctx.organizationId` in routes; the `orgId` param in lib helpers). For `receive-line.ts`, add an `orgId` param and thread it from its callers (grep `receive-line` / the `receiveLine(` calls).
4. `npm run -s tsc` (or `npx tsc --noEmit`) until **0 errors**.

### Phase 3 — Confirm direct inserts (§3a) + remove dead code
5. Confirm the 3 stamping inserts are intact; ensure the deleted unscoped INSERT (596) is gone.
6. Optional: delete dead `createSkuRecord`-era paths if any remain.

### Phase 4 — Migration
7. Add `src/lib/migrations/2026-06-XX_enforce_tenant_isolation_serial_units.sql`:
```sql
-- Phase E FORCE for serial_units. org_id NOT NULL + per-org unique already in place;
-- all prod writers stamp org or run under the app.current_org GUC (see plan §3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='serial_units') THEN
    PERFORM enforce_tenant_isolation('serial_units'::regclass);
    RAISE NOTICE 'FORCED tenant isolation on serial_units';
  END IF;
END $$;
```

### Phase 5 — Apply with the app_tenant safety harness (DO NOT skip)
8. Run the verification harness **before trusting the apply** — baseline reads as the real `app_tenant` role, apply, re-read, auto-rollback if FORCE hides rows. Reusable script (run with `node`, repo root, `.env` providing `DATABASE_URL` + `TENANT_APP_DATABASE_URL`):

```js
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { Pool } from 'pg';
const { config } = await import('dotenv'); config({ path: '.env' });
const USAV='00000000-0000-0000-0000-000000000001';
const FILE='2026-06-XX_enforce_tenant_isolation_serial_units.sql';
const sql=readFileSync(`src/lib/migrations/${FILE}`,'utf8');
const sum=createHash('sha256').update(sql,'utf8').digest('hex');
const owner=new Pool({connectionString:process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
const app=new Pool({connectionString:process.env.TENANT_APP_DATABASE_URL, ssl:{rejectUnauthorized:false}});
const oc=await owner.connect(), ac=await app.connect();
// IMPORTANT: GUC must be set INSIDE a txn (SET LOCAL is lost in autocommit)
const read=async()=>{ await ac.query('BEGIN'); await ac.query("SELECT set_config('app.current_org',$1,true)",[USAV]); const r=await ac.query('SELECT count(*)::int n FROM serial_units'); await ac.query('COMMIT'); return r.rows[0].n; };
const base=await read(); console.log('baseline app_tenant:', base);
await oc.query('BEGIN'); await oc.query(sql);
await oc.query('INSERT INTO schema_migrations(filename,sha256) VALUES($1,$2) ON CONFLICT DO NOTHING',[FILE,sum]);
await oc.query('COMMIT');
const post=await read(); console.log('post app_tenant:', post);
const z=await (async()=>{ await ac.query('BEGIN'); await ac.query("SELECT set_config('app.current_org','',true)"); const r=await ac.query('SELECT count(*)::int n FROM serial_units'); await ac.query('COMMIT'); return r.rows[0].n; })();
console.log('GUC-unset (expect 0):', z);
if (post !== base) { console.log('FORCE HID ROWS — relaxing'); await oc.query("SELECT relax_tenant_isolation('serial_units')"); }
else console.log('OK: reads intact, isolation active');
await oc.release(); await ac.release(); await owner.end(); await app.end();
```
9. If it reports `OK`, you're done. If it relaxed, the writers/readers still have a GUC gap — re-audit §3 before retrying.

### Phase 6 — Smoke test a real write
10. Through the app (as a USAV user), run a receive→serial flow (`/api/receiving/mark-received`, `/api/post-multi-sn`) and a tech scan, and confirm rows land with `organization_id` set and no `NOT NULL`/RLS errors.

---

## 5. Acceptance criteria
- [ ] `upsertSerialUnit` takes a **required** `orgId`; unscoped INSERT branch deleted.
- [ ] `tsc` 0 errors; all `upsertSerialUnit` callers pass org.
- [ ] Migration applied; `SELECT relforcerowsecurity FROM pg_class WHERE relname='serial_units'` → `true`.
- [ ] Harness: app_tenant reads (GUC=USAV) == baseline; GUC-unset == 0.
- [ ] Manual receive + tech-scan writes succeed.

## 6. Risks & notes
- **Single-tenant today** means GUC always = USAV = data; the harness's "reads == baseline" is the real safety gate. Re-run it whenever a new serial_units writer/reader lands.
- `unit-events.recordUnitEvent` is **test-only** — threading org there is for test fidelity, not prod safety. `serial-units-queries.test.ts` should pass org in its fixtures after Phase 1.
- Do **not** also FORCE `serial_unit_condition_history` / `item_workflow_state` / `order_unit_allocations` in this pass — they're separate tables with their own writer audits (follow-up).
- Coordinate timing: apply the migration **after** the threaded code is deployed (the loud-fail default rejects old un-threaded writes). On a dev DB you iterate against locally, apply once the local build is green.

## 7. After this: the bigger blockers
serial_units FORCE closes the unit aggregate. The **#1 remaining blocker for onboarding a 2nd org** is unrelated — the global `sku_catalog(sku)` / `sku_stock(sku)` keys (resellers share SKU strings). See the tenant-readiness audit in memory `receiving-tenant-hardening` for the full Class-1 list.
