-- ============================================================================
-- 2026-07-05d_receiving_spine_rename.sql
--
-- Receiving polymorphic refactor — FINAL destructive step: rename the spine
-- (plan §7 Step F / §8 step 14). Ends the "the carton *is* a `receiving` row"
-- confusion: `receiving` → `receiving_carton`, `receiving_lines` → `receiving_line`.
--
-- WHY NOW (out of the plan's ordering) + HOW IT STAYS SAFE:
-- The codebase has ~900 raw-SQL references to the old names (724 receiving_lines,
-- 195 bare receiving) across dozens of files, plus the Drizzle models. A code-wide
-- string rename on a LIVE app is high-risk. Instead we rename the BASE TABLES and
-- leave backward-compatible **auto-updatable views** under the OLD names, so every
-- existing `FROM receiving` / `receiving_lines` (SELECT/INSERT/UPDATE/DELETE/
-- RETURNING/FOR UPDATE) keeps working unchanged. The physical tables ARE renamed
-- and stay renamed; the views are a thin compat shim, removed once the last raw
-- reference is migrated to the canonical names.
--
-- SECURITY (non-negotiable): receiving / receiving_lines are FORCE ROW LEVEL
-- SECURITY. A normal view runs with the VIEW OWNER's privileges (neondb_owner,
-- BYPASSRLS) for ALL callers → tenant isolation would be BYPASSED for app_tenant.
-- So the shims are created `WITH (security_invoker = true)` (PG15+; PG here is
-- 17.10) — underlying access uses the QUERYING role, so RLS on the base tables
-- enforces exactly as before (owner bypasses, app_tenant is filtered). Precedent:
-- v_serial_unit_origins (2026-07-03c) uses the same setting for the same reason.
--
-- WHAT FOLLOWS THE RENAME AUTOMATICALLY (Postgres tracks by OID, not name):
--   - FKs pointing at receiving(id)/receiving_lines(id) (receiving_triage,
--     receiving_unbox, receiving_line_*, receiving_exceptions, local_pickup_items,
--     serial_unit provenance, …) now point at receiving_carton/receiving_line.
--   - Triggers (coarse-status on the line, 2026-06-29e line-facts, 2026-07-05c
--     trg_sync_receiving_street on the carton) move with their tables.
--   - Indexes, PKs, the owned id sequences, RLS policies — all follow the rename.
--   - The one dependent view (v_unfound_queue) auto-repoints to the new names.
-- Sub-object names (indexes/constraints/sequences still literally "receiving_*")
-- are cosmetic and deliberately NOT renamed — pure churn, zero behavior change.
--
-- APP CODE that must target the BASE TABLE (views cannot do these) is repointed
-- in the same change: the two ON CONFLICT upserts in receiving/lookup-po, and the
-- Drizzle pgTable() string names (so the query builder — incl. onConflict — hits
-- the real tables while raw SQL keeps hitting the views).
--
-- IDEMPOTENT: the rename is guarded on the object still being a BASE TABLE; the
-- shims use CREATE OR REPLACE VIEW. Re-running is a no-op.
--
-- ROLLBACK (dev only):
--   DROP VIEW IF EXISTS receiving_lines; DROP VIEW IF EXISTS receiving;
--   ALTER TABLE receiving_line RENAME TO receiving_lines;
--   ALTER TABLE receiving_carton RENAME TO receiving;
-- VERIFY: \d receiving_carton (base table); \d+ receiving (view, security_invoker);
--   app_tenant SELECT/INSERT through the views is org-filtered.
-- ============================================================================

BEGIN;

-- ── Rename the base tables (guarded → idempotent) ───────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'receiving'
               AND table_type = 'BASE TABLE') THEN
    EXECUTE 'ALTER TABLE receiving RENAME TO receiving_carton';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'receiving_lines'
               AND table_type = 'BASE TABLE') THEN
    EXECUTE 'ALTER TABLE receiving_lines RENAME TO receiving_line';
  END IF;
END $$;

-- ── Backward-compat shims (auto-updatable, RLS-preserving) ──────────────────
-- security_invoker=true: RLS on the base tables enforces per the QUERYING role,
-- so these are NOT a tenant-isolation hole. SELECT * → auto-updatable (INSERT/
-- UPDATE/DELETE/RETURNING/FOR UPDATE all pass through). ON CONFLICT is the one
-- thing views can't do — those call sites target the base tables directly (code).
CREATE OR REPLACE VIEW receiving
  WITH (security_invoker = true) AS
  SELECT * FROM receiving_carton;

CREATE OR REPLACE VIEW receiving_lines
  WITH (security_invoker = true) AS
  SELECT * FROM receiving_line;

COMMENT ON VIEW receiving IS
  'COMPAT SHIM (2026-07-05d): receiving was renamed to receiving_carton. Auto-updatable, security_invoker=true (RLS enforced per querying role). New code uses receiving_carton; this view keeps legacy raw SQL working until refs are migrated. ON CONFLICT must target receiving_carton.';
COMMENT ON VIEW receiving_lines IS
  'COMPAT SHIM (2026-07-05d): receiving_lines was renamed to receiving_line. Auto-updatable, security_invoker=true (RLS enforced per querying role). New code uses receiving_line; this view keeps legacy raw SQL working until refs are migrated. ON CONFLICT must target receiving_line.';

-- ── Runtime-role grants on the shims (belt-and-suspenders; ALTER DEFAULT
--    PRIVILEGES already covers owner-created relations incl. views). ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON receiving      TO app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON receiving_lines TO app_tenant;
  END IF;
END $$;

COMMIT;
