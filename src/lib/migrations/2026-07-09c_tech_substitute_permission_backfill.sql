-- Backfill tech.substitute_unit (+ the orders.view read it depends on) onto
-- every role that already has tech.scan_serial.
--
-- Why: the tech-substitution wiring (docs/todo/tech-substitution-wiring-plan.md
-- §3.3 Option B / §5 Phase 0.4) added a dedicated tech.substitute_unit
-- permission (src/lib/auth/permission-registry.ts) and taught
-- POST /api/orders/[id]/substitute to accept packing.substitute_unit OR
-- tech.substitute_unit. A brand-new permission is never retroactively granted
-- to an existing role's stored `permissions` text[] just by adding it to the
-- registry — `roles` is a single GLOBAL table (no organization_id) and
-- scripts/seed-roles.mjs's re-seed does not overwrite `permissions` on an
-- existing row (same DB-state-only situation as
-- 2026-07-01h_rma_permission_backfill.sql, whose shape this copies).
--
-- tech.scan_serial is the anchor: it is the tech-bench mutation permission,
-- so any role that can run the tech scan loop gets the substitution raise.
--
-- orders.view is included because the SubstituteUnitCard's reads
-- (GET /api/orders/[id]/pick-tasks and /amendments) are gated orders.view and
-- the seeded technician role does not carry it — without this, the card's
-- allocation/history fetches 403 even though the POST would succeed.
--
-- admin is unaffected either way (computeEffectivePermissions short-circuits
-- any admin-containing role-set to ALL_PERMISSIONS at runtime,
-- src/lib/auth/permissions-shared.ts) but is included below for consistency
-- — harmless, and keeps the stored row coherent.
--
-- Safety / idempotency: each UPDATE only appends when tech.scan_serial is
-- present AND the target permission is not already present, so re-running this
-- file (or applying it after someone has since granted either by hand via the
-- Roles editor) is a no-op. No new columns/tables; nothing to enforce or scope.
--
-- Rollback: for any role where this migration was the only source of the
-- grant, `UPDATE roles SET permissions = array_remove(permissions, 'tech.substitute_unit') WHERE key IN (...)`
-- (and likewise for orders.view). Not scripted here since it would also strip
-- a legitimately hand-granted permission.
--
-- Verify: `SELECT key, permissions FROM roles WHERE 'tech.scan_serial' = ANY(permissions);`
-- — every row should now also carry tech.substitute_unit and orders.view.

BEGIN;

UPDATE roles
   SET permissions = permissions || ARRAY['tech.substitute_unit']::text[],
       updated_at = now()
 WHERE 'tech.scan_serial' = ANY(permissions)
   AND NOT ('tech.substitute_unit' = ANY(permissions));

UPDATE roles
   SET permissions = permissions || ARRAY['orders.view']::text[],
       updated_at = now()
 WHERE 'tech.scan_serial' = ANY(permissions)
   AND NOT ('orders.view' = ANY(permissions));

COMMIT;
