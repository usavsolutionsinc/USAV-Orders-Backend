# Pending Migrations — Apply Plan

_Last updated: 2026-06-03_

This plan covers the hand-written SQL migrations in `src/lib/migrations/` that are
not yet applied on every environment, how to apply them safely, in what order,
their prerequisites, risk, and rollback. It exists because the migration runner
(`scripts/run-pending-migrations.mjs`, invoked via `npm run db:migrate`) applies
**all** pending files at once — there is no per-file flag — so applying a single
migration requires the surgical procedure documented at the end.

## Current state (as of 2026-06-03)

| Migration | Status | Risk | Reversible |
| --- | --- | --- | --- |
| `2026-06-02_zoho_fulfillment_sync.sql` | ✅ applied | low (new table) | yes |
| `2026-06-02_carrier_webhook_subscription.sql` | ⏳ pending | low (additive columns) | yes |
| `2026-06-02_staff_stations.sql` | ⏳ pending | low (new table) | yes |
| `2026-06-02_hermes_agent_rls_read.sql` | ⏳ pending | medium (broad RLS; role prereq) | yes |
| `2026-06-02_condition_grade_refurb_like_new.sql` | ⏳ pending | low data risk, **one-way** | ❌ no |

> The runner tracks applied files in `schema_migrations` (filename + sha256). It
> is idempotent and refuses to re-apply a file whose contents changed since it
> was recorded.

## Recommended apply order

The four pending migrations are independent (no cross-dependencies), but apply in
this order so the riskiest/irreversible one is last and only run deliberately:

1. **`carrier_webhook_subscription.sql`** — additive columns + indexes on `shipping_tracking_numbers`.
2. **`staff_stations.sql`** — new `staff_stations` table.
3. **`hermes_agent_rls_read.sql`** — only after confirming the `hermes_agent` role exists (see prereq).
4. **`condition_grade_refurb_like_new.sql`** — last; adds enum values that **cannot be removed**.

---

## Per-migration detail

### 1. `carrier_webhook_subscription.sql`  — low risk, additive
- **What:** adds `webhook_subscription_status`, `webhook_subscribed_at`, `webhook_subscription_job_id`, `webhook_subscription_error` to `shipping_tracking_numbers`; a CHECK constraint on the status; two partial indexes (`idx_stn_webhook_pending`, `idx_stn_webhook_submitted`).
- **Why:** tracks each shipment's FedEx/UPS webhook-subscription lifecycle (`PENDING → SUBMITTED → COMPLETED/FAILED`) so the `subscribe-fedex` / `subscribe-ups` crons can find un-subscribed shipments, skip already-associated ones, and retry failures. Part of the carrier live-tracking work; polling remains the fallback.
- **Objects:** `shipping_tracking_numbers` only. All `ADD COLUMN IF NOT EXISTS`.
- **Prereq:** none.
- **Risk:** low — purely additive; existing sync behavior unchanged.
- **Verify:**
  ```sql
  SELECT column_name FROM information_schema.columns
   WHERE table_name = 'shipping_tracking_numbers'
     AND column_name LIKE 'webhook_subscription%';
  ```
- **Rollback:**
  ```sql
  ALTER TABLE shipping_tracking_numbers
    DROP COLUMN IF EXISTS webhook_subscription_status,
    DROP COLUMN IF EXISTS webhook_subscribed_at,
    DROP COLUMN IF EXISTS webhook_subscription_job_id,
    DROP COLUMN IF EXISTS webhook_subscription_error;
  -- (indexes/constraint drop with the columns)
  ```

### 2. `staff_stations.sql`  — low risk, additive
- **What:** creates `staff_stations` (`staff_id`, `station`, `is_primary`, `assigned_at`, `assigned_by`), a unique "one primary per staff" partial index, and a lookup index.
- **Why:** per-staff primary + secondary station assignments (TECH/PACK/UNBOX/SALES/FBA) that drive the header goal chip's "Switch" control. Staff with no rows fall back to the employee_id-prefix station, so existing users are unaffected.
- **Objects:** new table + indexes; FKs to `staff`.
- **Prereq:** `staff` table exists (it does).
- **Risk:** low — new table, no existing rows touched.
- **Verify:** `SELECT to_regclass('public.staff_stations');`
- **Rollback:** `DROP TABLE IF EXISTS staff_stations;`

### 3. `hermes_agent_rls_read.sql`  — medium scope, SELECT-only
- **What:** loops over every RLS-enabled table in `public` and creates a `hermes_agent_read` policy (`FOR SELECT TO hermes_agent USING (true)`).
- **Why:** the read-only `hermes_agent` role (AI chat) otherwise sees zero rows because its tenant predicate resolves to NULL. Mirrors the source-of-truth file in the sibling `hermes-usav` repo.
- **Objects:** RLS policies across all RLS tables — but scoped to the `hermes_agent` role and SELECT only; application roles and write protection are unaffected.
- **⚠️ Prereq:** the **`hermes_agent` role must already exist**, or the `CREATE POLICY ... TO hermes_agent` will error and roll back. Confirm first:
  ```sql
  SELECT 1 FROM pg_roles WHERE rolname = 'hermes_agent';
  ```
  If absent, create the role (per the hermes-usav setup) before applying.
- **Risk:** medium — broad object footprint, but read-only and role-scoped. Re-runnable (drops policy if exists, recreates).
- **Verify:**
  ```sql
  SELECT count(*) FROM pg_policies WHERE policyname = 'hermes_agent_read';
  ```
- **Rollback:** drop the `hermes_agent_read` policy on each RLS table (same loop pattern with `DROP POLICY IF EXISTS`).

### 4. `condition_grade_refurb_like_new.sql`  — ❌ one-way (enum values)
- **What:** `ALTER TYPE condition_grade_enum ADD VALUE 'LIKE_NEW'` and `'REFURBISHED'`.
- **Why:** extends the condition scale (New > Like New > Refurbished > Used > Parts) for the shared ConditionPills picker (receiving `LineEditPanel` + shipped `ProductDetailsSection`).
- **Objects:** `condition_grade_enum`, which backs `receiving_lines.condition_grade`, `serial_units.condition_grade`, `serial_unit_condition_history.condition_grade`.
- **Prereq:** none.
- **Risk:** low for data (additive; no rows change), but **Postgres cannot remove enum values** — this migration is effectively irreversible. Apply only when you actually want these grades selectable.
- **Verify:**
  ```sql
  SELECT enumlabel FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'condition_grade_enum' ORDER BY e.enumsortorder;
  ```
- **Rollback:** not supported. (Removing an enum value requires recreating the type and rewriting every dependent column — do not attempt as a routine rollback.)

---

## How to apply

### Option A — apply everything pending (standard)
Use when the DB is simply behind `main` and you want all four. Note this also
runs anything else pending at the time.
```bash
npm run db:migrate:dry   # preview the pending list
npm run db:migrate       # apply all pending in filename order, each in its own tx
```

### Option B — apply a single migration (surgical)
The runner has no per-file flag. To apply just one file and keep
`schema_migrations` consistent (this is exactly how `zoho_fulfillment_sync` was
applied), run its SQL in a transaction and record the row:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { config } from "dotenv";
config({ path: ".env.local" }); config({ path: ".env" });
const fname = "2026-06-02_staff_stations.sql";          // <-- change per file
const sql = readFileSync("src/lib/migrations/" + fname, "utf8");
const sum = createHash("sha256").update(sql, "utf8").digest("hex");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query(sql);
  await c.query("INSERT INTO schema_migrations (filename, sha256) VALUES ($1,$2) ON CONFLICT (filename) DO NOTHING", [fname, sum]);
  await c.query("COMMIT");
  console.log("APPLIED:", fname);
} catch (e) { await c.query("ROLLBACK").catch(()=>{}); console.error("FAILED:", e.message); process.exit(1); }
finally { c.release(); await pool.end(); }
'
```

## Pre-flight checklist (production)

1. **Backup / snapshot** the database (or confirm PITR is enabled).
2. `npm run db:migrate:dry` and confirm the pending list matches expectations.
3. For `hermes_agent_rls_read`: confirm `hermes_agent` role exists.
4. Decide on `condition_grade_refurb_like_new` deliberately — it is one-way.
5. Apply (Option A or B), then run each migration's **Verify** query.
6. Smoke-test the dependent features (carrier subscribe crons, header goal chip
   station switch, AI chat row visibility, ConditionPills new grades).
