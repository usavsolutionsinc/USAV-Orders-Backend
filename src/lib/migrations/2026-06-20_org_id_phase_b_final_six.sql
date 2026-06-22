-- ============================================================================
-- 2026-06-20_org_id_phase_b_final_six.sql   (Phase B — the deferred AI/photos tables)
--
-- Wave 6: resolves 6 of the 7 tables that 2026-06-14_org_id_phase_b_needs_col_2.sql
-- DELIBERATELY deferred pending a product decision (the 7th,
-- api_idempotency_responses, is handled in its own migration because its natural
-- key semantics change). Decisions:
--
--   hermes_insights, hermes_precision_scores, hermes_thresholds  → PER-TENANT.
--     Each tenant gets its own AI insights / precision metrics / tuning thresholds.
--   hermes_outcomes  → CHILD of hermes_insights (org derived via insight_id FK).
--   google_photos_albums, google_photos_settings  → PER-TENANT (a tenant's own
--     Google Photos backup config / album mirror).
--
-- ⚠ NULLABLE, no PK/NOT-NULL change — ON PURPOSE. The hermes_* tables are
--   written by the EXTERNAL Hermes service (sibling repo ~/Desktop/my-express-app/
--   hermes-usav owns their SoT); it won't stamp organization_id yet, and changing
--   their PKs would break its ON CONFLICT writers. So this is additive scaffolding:
--   column + USAV backfill + GUC default + FK + index + ARMED (non-FORCE) policy,
--   plus the hermes_agent_read bypass so the AI agent role keeps its cross-org read.
--   FOLLOW-UP before FORCE: thread org through the Hermes writer, SET NOT NULL.
--
-- ⚠ INERT UNTIL E1 (app_tenant loses BYPASSRLS). Scaffolding only — does NOT call
--   enforce_tenant_isolation(). Idempotent, roll-forward only.
-- ============================================================================

DO $$
DECLARE
  t text;
  -- Per-tenant roots (USAV backfill, same idiom as needs_col_2).
  root_tables text[] := ARRAY[
    'hermes_insights',
    'hermes_precision_scores',
    'hermes_thresholds',
    'google_photos_albums',
    'google_photos_settings'
  ];
  table_exists boolean;
  col_exists boolean;
  has_hermes_agent boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_agent');
BEGIN
  FOREACH t IN ARRAY root_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema=''public'' AND table_name=%L)', t
    ) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=''public'' AND table_name=%L AND column_name=''organization_id'')', t
    ) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id uuid', t);
      RAISE NOTICE 'added organization_id to %', t;
    END IF;

    -- Backfill existing rows to USAV (the only tenant today).
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL', t
    );
    -- New rows default from the tenant GUC (NULL when unset → no loud-fail, so the
    -- external Hermes writer keeps working until it threads org).
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid', t
    );
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_organization_fk');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      t, t || '_organization_fk'
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)', 'idx_' || t || '_organization', t);

    -- ARMED, non-FORCE policy (inert under the bypass owner role).
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
    -- AI agent reads across orgs via its dedicated role.
    IF has_hermes_agent THEN
      EXECUTE format('DROP POLICY IF EXISTS hermes_agent_read ON %I', t);
      EXECUTE format('CREATE POLICY hermes_agent_read ON %I FOR SELECT TO hermes_agent USING (true)', t);
    END IF;
  END LOOP;

  -- ── hermes_outcomes — CHILD of hermes_insights ────────────────────────────
  -- org derived from the parent insight (correct even pre-single-tenant), with a
  -- USAV fallback for any orphan.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='hermes_outcomes') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hermes_outcomes' AND column_name='organization_id') THEN
      ALTER TABLE hermes_outcomes ADD COLUMN organization_id uuid;
      RAISE NOTICE 'added organization_id to hermes_outcomes';
    END IF;

    UPDATE hermes_outcomes o
       SET organization_id = i.organization_id
      FROM hermes_insights i
     WHERE o.insight_id = i.id
       AND o.organization_id IS NULL
       AND i.organization_id IS NOT NULL;
    UPDATE hermes_outcomes
       SET organization_id = '00000000-0000-0000-0000-000000000001'
     WHERE organization_id IS NULL;

    ALTER TABLE hermes_outcomes
      ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid;
    ALTER TABLE hermes_outcomes DROP CONSTRAINT IF EXISTS hermes_outcomes_organization_fk;
    ALTER TABLE hermes_outcomes
      ADD CONSTRAINT hermes_outcomes_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
    CREATE INDEX IF NOT EXISTS idx_hermes_outcomes_organization ON hermes_outcomes (organization_id);

    ALTER TABLE hermes_outcomes ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS hermes_outcomes_tenant_isolation ON hermes_outcomes;
    CREATE POLICY hermes_outcomes_tenant_isolation ON hermes_outcomes
      USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
    IF has_hermes_agent THEN
      DROP POLICY IF EXISTS hermes_agent_read ON hermes_outcomes;
      CREATE POLICY hermes_agent_read ON hermes_outcomes FOR SELECT TO hermes_agent USING (true);
    END IF;
  END IF;
END $$;
