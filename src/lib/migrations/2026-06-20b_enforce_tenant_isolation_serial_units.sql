-- ============================================================================
-- 2026-06-20b_enforce_tenant_isolation_serial_units.sql
--
-- Phase E (per-table FORCE) for serial_units — the unit master aggregate. Same
-- model as the receiving-core and packer/tech waves: enforce_tenant_isolation()
-- atomically (a) flips the organization_id DEFAULT from the USAV-fallback to a
-- LOUD-FAIL (nullif(current_setting('app.current_org'))::uuid), (b) ENABLE +
-- FORCE ROW LEVEL SECURITY, (c) (re)creates the canonical tenant_isolation
-- policy, (d) preserves the hermes_agent cross-tenant READ bypass.
--
-- ── GATING (why this is safe to apply now) ──────────────────────────────────
-- organization_id is already NOT NULL (0 NULL rows) and the natural key is
-- per-org (ux_serial_units_org_normalized_serial; the global
-- serial_units_normalized_uniq was dropped in
-- 2026-06-19_serial_units_org_scoped_unique.sql). RLS is INERT for neondb_owner
-- (BYPASSRLS); the only effect that bites immediately is the loud-fail DEFAULT,
-- so this is safe ONLY because every PRODUCTION serial_units writer now stamps
-- organization_id (explicitly) or runs under the app.current_org GUC. Audited +
-- threaded 2026-06-20:
--   upsertSerialUnit (neon/serial-units-queries) — the single canonical writer.
--     orgId is now REQUIRED; the unscoped INSERT/UPDATE branch + raw-pool
--     dispatcher were deleted, so it always stamps org (and sets the GUC on an
--     external client). Callers threaded: post-multi-sn, receiving/mark-received,
--     receiving/scan-serial + mark-received-po (via attachSerialToLine),
--     receive-line (receiveLineUnits), serial-attach (attachSerialToLine, whose
--     pre-tenancy raw-pool path was removed), syncTsnToSerialUnit
--     (receiving/serials), syncSkuToSerialUnit.
--   mark-received raw fallback INSERT — stamps organization_id + ON CONFLICT
--     (organization_id, normalized_serial).
--   insertTechSerialForTracking — stamps organization_id + per-org ON CONFLICT.
--   (recordUnitEvent in inventory/unit-events is TEST-ONLY — not a runtime
--    writer; its fixtures pass org for parity.)
--
-- Verify before trusting the apply with the app_tenant harness in the plan
-- (docs/serial-units-tenant-force-plan.md §5): baseline reads as app_tenant
-- (GUC=USAV) must equal post-apply reads, and GUC-unset must read 0.
--
-- ROLLBACK: select relax_tenant_isolation('serial_units') restores NO FORCE +
-- the transitional USAV-fallback default.
--
-- Idempotent: enforce_tenant_isolation uses create-or-replace / drop-if-exists
-- internally; the DO-block skips the table if absent in this DB.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'serial_units'
  ) THEN
    PERFORM enforce_tenant_isolation('serial_units'::regclass);
    RAISE NOTICE 'enforce_tenant_isolation: FORCED tenant isolation on serial_units';
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation: skipping serial_units (absent in this DB)';
  END IF;
END $$;
