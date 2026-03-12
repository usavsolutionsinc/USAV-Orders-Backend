-- Close active REPAIR work_assignments for repair_service rows already marked Done.
--
-- Why:
-- Some historical repairs were marked Done in repair_service but their unified
-- work_assignments row remained ASSIGNED / IN_PROGRESS. Work-order queries join
-- active REPAIR assignments, so those stale rows keep appearing in the repair
-- work-order queue.
--
-- Scope:
-- Only update assigned REPAIR work assignments tied to repair_service.status='Done'.

UPDATE work_assignments wa
SET
  status = 'DONE',
  completed_at = COALESCE(wa.completed_at, NOW()),
  updated_at = NOW()
FROM repair_service rs
WHERE wa.entity_type = 'REPAIR'
  AND wa.work_type = 'REPAIR'
  AND wa.entity_id = rs.id
  AND wa.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
  AND wa.assigned_tech_id IS NOT NULL
  AND COALESCE(rs.status, '') = 'Done';
