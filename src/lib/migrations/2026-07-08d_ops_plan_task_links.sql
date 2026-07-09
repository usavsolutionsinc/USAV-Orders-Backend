-- Ops plan task links + progress rollup function (Operations Plan Mode v1).
--
-- Links bridge strategic plan tasks to operational work_assignments without
-- merging the two domains. Rollup function is read-only for list/detail APIs.
-- Rollback: DROP FUNCTION ops_plan_progress; DROP TABLE ops_plan_task_links;

BEGIN;

CREATE TABLE IF NOT EXISTS ops_plan_task_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL,
  task_id           UUID NOT NULL REFERENCES ops_plan_tasks(id) ON DELETE CASCADE,
  link_type         TEXT NOT NULL,
  link_entity_type  TEXT,
  link_entity_id    TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_plan_task_links_type_chk CHECK (
    link_type IN ('work_assignment', 'inventory_event', 'manual')
  ),
  CONSTRAINT ops_plan_task_links_unique UNIQUE (
    task_id, link_type, link_entity_type, link_entity_id
  )
);

CREATE INDEX IF NOT EXISTS idx_ops_plan_task_links_entity
  ON ops_plan_task_links (organization_id, link_entity_type, link_entity_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    PERFORM enforce_tenant_isolation('ops_plan_task_links');
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — ops_plan_task_links left without FORCE RLS';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ops_plan_progress(p_plan_id UUID, p_org_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH tasks AS (
    SELECT t.status,
           p.station
      FROM ops_plan_tasks t
      JOIN ops_plan_phases p ON p.id = t.phase_id AND p.organization_id = t.organization_id
     WHERE p.plan_id = p_plan_id
       AND p.organization_id = p_org_id
  ),
  totals AS (
    SELECT COUNT(*)::int AS total_tasks,
           COUNT(*) FILTER (WHERE status = 'done')::int AS done_tasks,
           COUNT(*) FILTER (WHERE status = 'canceled')::int AS canceled_tasks
      FROM tasks
  ),
  by_station AS (
    SELECT station,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'done')::int AS done
      FROM tasks
     GROUP BY station
     ORDER BY station
  )
  SELECT jsonb_build_object(
    'planId', p_plan_id,
    'totalTasks', COALESCE((SELECT total_tasks FROM totals), 0),
    'doneTasks', COALESCE((SELECT done_tasks FROM totals), 0),
    'canceledTasks', COALESCE((SELECT canceled_tasks FROM totals), 0),
    'percentComplete',
      CASE
        WHEN COALESCE((SELECT total_tasks FROM totals), 0) - COALESCE((SELECT canceled_tasks FROM totals), 0) <= 0 THEN 0
        ELSE ROUND(
          100.0 * COALESCE((SELECT done_tasks FROM totals), 0)
          / NULLIF(
              COALESCE((SELECT total_tasks FROM totals), 0) - COALESCE((SELECT canceled_tasks FROM totals), 0),
              0
            )
        )::int
      END,
    'byStation', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'station', bs.station,
          'total', bs.total,
          'done', bs.done,
          'percentComplete',
            CASE
              WHEN bs.total <= 0 THEN 0
              ELSE ROUND(100.0 * bs.done / bs.total)::int
            END
        )
        ORDER BY bs.station
      ) FROM by_station bs),
      '[]'::jsonb
    )
  );
$$;

COMMIT;
