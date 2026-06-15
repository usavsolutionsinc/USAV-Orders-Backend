-- ============================================================================
-- 2026-06-14_org_id_phase_b_needs_col.sql   (Phase B — schema coverage)
--
-- Adds organization_id to the tables the 2026-06-14 parallel route sweep proved
-- could NOT be isolated by GUC-wrapping alone, because they carry NO own
-- organization_id column (coverage = "tenant-owned-NEEDS-COL" or "child-scoped"
-- with parent-scoping GAPS the adversarial verifiers found):
--
--   tenant-owned-NEEDS-COL : suppliers, square_transactions, warehouses
--   child-scoped w/ gaps   : sourcing_candidates, sourcing_alerts, sourcing_searches
--                            (SKU-less rows have NO parent to scope through),
--                            rma_authorizations (order-less / standalone rows).
--
-- The sweep added the GUC plumbing (tenantQuery / withTenantTransaction) to the
-- request paths for these tables, but a GUC + RLS policy needs a COLUMN to bind
-- to. Until this lands, those reads/writes are NOT isolated (e.g. the
-- square_transactions GET returns every org's sales; getSupplierList is global).
-- They are LATENT today (USAV is the only tenant) but become live leaks at
-- tenant #2.
--
-- ⚠ NULLABLE ON PURPOSE (differs from 2026-06-14_org_id_phase_b_domain_children,
--   which used NOT NULL): these tables still have UN-THREADED session-less
--   writers that the sweep recorded in stoppedFiles and did NOT migrate —
--     - square_transactions: src/app/api/webhooks/square/route.ts (insertSquareTransaction, no session)
--     - sourcing_*: src/lib/jobs/{sourcing-scan,scour-watch,replenishment-watch}.ts + src/lib/sourcing/search.ts
--   A NOT NULL + GUC-default column would loud-fail those inserts (no GUC set).
--   So we add the column NULLABLE with a USAV backfill + GUC default. The
--   FOLLOW-UP before FORCE (Phase E) for each table: (1) thread org through the
--   session-less writers above, (2) ALTER COLUMN organization_id SET NOT NULL,
--   (3) add the explicit `organization_id` predicate + stamp in the query module
--   (suppliers-queries.ts / square-transaction-queries.ts / sourcing-*-queries.ts
--   / rma/authorizations.ts), (4) for square_transactions also swap the global
--   ON CONFLICT (square_order_id) → (organization_id, square_order_id) and for
--   suppliers the global uniq_suppliers_ebay_seller → composite.
--
-- ⚠ INERT UNTIL E1 (app_tenant loses BYPASSRLS): ENABLE RLS + the armed policy
--   grant ZERO isolation under neondb_owner. This is scaffolding only; real
--   isolation begins when app_tenant is live AND enforce_tenant_isolation()
--   FORCEs each table. Do NOT call enforce_tenant_isolation() here.
--
-- Idempotent (IF [NOT] EXISTS throughout) and roll-forward only.
-- ============================================================================

DO $$
DECLARE
  t text;
  needs_col_tables text[] := ARRAY[
    'suppliers',
    'square_transactions',
    'warehouses',
    'sourcing_candidates',
    'sourcing_alerts',
    'sourcing_searches',
    'rma_authorizations'
  ];
  table_exists boolean;
  col_exists boolean;
BEGIN
  FOREACH t IN ARRAY needs_col_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ''public'' AND table_name = %L)',
      t
    ) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', t;
      CONTINUE;
    END IF;

    -- 1. Add the column (NULLABLE — see header). Skip if already present.
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ''public'' AND table_name = %L AND column_name = ''organization_id'')',
      t
    ) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id uuid', t);
      RAISE NOTICE 'added organization_id to %', t;
    END IF;

    -- 2. Backfill existing rows to USAV (the only tenant today).
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL',
      t
    );

    -- 3. Default new rows from the tenant GUC (NULL when unset — no loud-fail,
    --    so the un-threaded session-less writers keep working until threaded).
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid',
      t
    );

    -- 4. FK to organizations(id) (NULLs are allowed by the FK; harmless until NOT NULL).
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_organization_fk');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      t, t || '_organization_fk'
    );

    -- 5. Index by org.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      'idx_' || t || '_organization', t
    );

    -- 6. ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
