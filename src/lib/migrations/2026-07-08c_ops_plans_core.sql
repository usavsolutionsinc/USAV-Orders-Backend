-- Strategic ops plans — company-wide initiatives with station-grouped phases and
-- delegatable tasks (Operations Plan Mode backend v1).
--
-- Safety: idempotent DDL; every writer runs under withTenantTransaction and stamps
-- organization_id explicitly. enforce_tenant_isolation() lands FORCE RLS + loud-fail
-- org default when the helper exists (2026-06-14_rls_enforcement_infra.sql).
-- Rollback: relax_tenant_isolation per table, then DROP tables (dev only).

BEGIN;

DO $$ BEGIN
  CREATE TYPE ops_plan_status AS ENUM ('draft', 'active', 'paused', 'done', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ops_plan_phase_status AS ENUM ('open', 'in_progress', 'done', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ops_plan_task_status AS ENUM ('open', 'in_progress', 'done', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS ops_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  status              ops_plan_status NOT NULL DEFAULT 'draft',
  target_date         DATE,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  archived_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_plans_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT ops_plans_archived_at_consistency CHECK (
    status <> 'archived' OR archived_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ops_plans_org_status
  ON ops_plans (organization_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ops_plans_org_target
  ON ops_plans (organization_id, target_date)
  WHERE status IN ('active', 'paused');

CREATE TABLE IF NOT EXISTS ops_plan_phases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  plan_id         UUID NOT NULL REFERENCES ops_plans(id) ON DELETE CASCADE,
  station         TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          ops_plan_phase_status NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_plan_phases_station_chk CHECK (
    station IN ('RECEIVING', 'TECH', 'PACK', 'FBA', 'LABELS', 'ADMIN')
  ),
  CONSTRAINT ops_plan_phases_title_len CHECK (char_length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_ops_plan_phases_plan_order
  ON ops_plan_phases (plan_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_ops_plan_phases_org_station
  ON ops_plan_phases (organization_id, station)
  WHERE status <> 'done';

CREATE TABLE IF NOT EXISTS ops_plan_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL,
  phase_id              UUID NOT NULL REFERENCES ops_plan_phases(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  assignee_staff_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status                ops_plan_task_status NOT NULL DEFAULT 'open',
  due_at                TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  completed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  notes                 TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  client_event_id       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_plan_tasks_title_len CHECK (char_length(title) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_ops_plan_tasks_assignee_open
  ON ops_plan_tasks (organization_id, assignee_staff_id, status)
  WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_ops_plan_tasks_unassigned
  ON ops_plan_tasks (organization_id, status)
  WHERE assignee_staff_id IS NULL AND status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_ops_plan_tasks_due
  ON ops_plan_tasks (organization_id, due_at)
  WHERE status IN ('open', 'in_progress');

CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_plan_tasks_org_client_event
  ON ops_plan_tasks (organization_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    RAISE NOTICE 'enforce_tenant_isolation absent — ops_plans tables left without FORCE RLS';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['ops_plans', 'ops_plan_phases', 'ops_plan_tasks'] LOOP
    PERFORM enforce_tenant_isolation(t);
  END LOOP;
END $$;

COMMIT;
