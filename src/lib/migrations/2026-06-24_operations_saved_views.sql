-- Server-backed saved views for the Master Operations Journey (Operations ▸
-- History). One row per named filter/view preset, owned by a staff member within
-- an org. Applying a view just rewrites the URL params; this table only persists
-- the named snapshot so it survives reloads and syncs across a user's devices.
--
-- Tenant-scoped from birth: organization_id NOT NULL, enforced via the
-- enforce_tenant_isolation() helper (2026-06-14_rls_enforcement_infra.sql) so the
-- loud-fail DEFAULT + FORCE RLS + canonical tenant_isolation policy land in one
-- shot. Safe because the only writer (operations/saved-views routes) runs inside
-- withTenantTransaction (sets app.current_org) AND stamps organization_id
-- explicitly. Mirrors the staff_preferences precedent (raw SQL, not Drizzle).

CREATE TABLE IF NOT EXISTS operations_saved_views (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  staff_id        INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  -- The full journey filter snapshot:
  --   { dim, order|serial|tracking, from, until, stations[], types[], staffId,
  --     status, q }
  -- One JSONB bag so adding a new filter never needs a column or a migration.
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Visible to the whole org (true) vs private to the creator (false, default).
  is_shared       BOOLEAN NOT NULL DEFAULT false,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operations_saved_views_name_chk CHECK (length(btrim(name)) > 0),
  -- One view name per staff per org (the ownership boundary is staff_id).
  CONSTRAINT operations_saved_views_org_staff_name_uniq UNIQUE (organization_id, staff_id, name)
);

CREATE INDEX IF NOT EXISTS idx_operations_saved_views_org_staff
  ON operations_saved_views (organization_id, staff_id, sort_order);
-- Org-wide shared-view lookup.
CREATE INDEX IF NOT EXISTS idx_operations_saved_views_org_shared
  ON operations_saved_views (organization_id) WHERE is_shared = true;

-- Flip on FORCE RLS + loud-fail org default + canonical policy, if the
-- enforcement infra is present (it is, post-2026-06-14). Guarded so a fresh DB
-- without the helper still gets the table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('operations_saved_views');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — operations_saved_views left without FORCE RLS';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Browse-mode perf indexes for the journey UNION.
--
-- The browse query orders the org's recent activity newest-first across five
-- spines. The existing indexes on these tables lead with a subject column
-- (serial_unit_id, shipment_id, …), not (organization_id, <time>), so the
-- org-wide `ORDER BY <time> DESC` does a large sort. A composite
-- (organization_id, <time> DESC) makes browse a backward index scan.
--
-- Entity mode needs NO new index (it rides the existing subject-leading indexes
-- via indexed point lookups).
--
-- Plain (non-CONCURRENT) CREATE INDEX so this stays inside the standard
-- migration transaction; these take a brief lock — acceptable at current volumes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sal_org_created
  ON station_activity_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_events_org_occurred
  ON inventory_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_events_org_created
  ON warranty_claim_events (organization_id, created_at DESC);

-- Order-anchored audit rows only. The partial predicate MUST match the browse
-- branch's `WHERE lower(entity_type) = 'order'` exactly, or the planner won't
-- recognize the implication and the partial index goes unused.
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON audit_logs (organization_id, created_at DESC)
  WHERE lower(entity_type) = 'order';

-- The browse inventory branch resolves each event's owning order via a
-- LATERAL (serial_unit_id + organization_id, newest allocation). The existing
-- order_unit_allocations indexes don't cover that lookup + sort, so the lateral
-- would sort per row; this composite makes it a single index probe.
CREATE INDEX IF NOT EXISTS idx_oua_journey_unit_org_alloc
  ON order_unit_allocations (serial_unit_id, organization_id, allocated_at DESC);

-- NB: no carrier-events index is added here. `shipment_tracking_events` is
-- org-less; the browse carrier branch is org-gated via `orders.shipment_id`. The
-- existing baseline index `idx_events_shipment_id_time (shipment_id,
-- event_occurred_at DESC)` serves the org-first probe (orders → carrier events).
-- Deliberately NOT adding a bare `(event_occurred_at)` index, which would tempt
-- the planner into a cross-tenant time-first scan of every org's carrier events.
