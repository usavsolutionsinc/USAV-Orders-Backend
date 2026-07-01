-- Backfill rma.view / rma.manage onto every role that already has orders.view.
--
-- Why: the returns-unification initiative (docs/returns-receiving-order-
-- unification-plan.md §6 Gap #8 / §9 Stage 1) migrated the RMA routes
-- (src/app/api/rma/**) off the generic orders.view permission onto a
-- dedicated rma.view/rma.manage pair (added to src/lib/auth/permission-
-- registry.ts in the same change). Without this backfill, any role that
-- currently reaches those routes via orders.view loses access the moment
-- that code deploys — `roles` is a single GLOBAL table (no organization_id,
-- src/lib/drizzle/schema.ts:201-216), and a brand-new permission is never
-- retroactively granted to an existing role's stored `permissions` text[]
-- just by adding it to the registry (scripts/seed-roles.mjs's re-seed does
-- not overwrite `permissions` on an existing row either — this is genuinely
-- DB-state-only and can't be fixed by a code/seed-script edit alone).
--
-- admin is unaffected either way (computeEffectivePermissions short-circuits
-- any admin-containing role-set to ALL_PERMISSIONS at runtime,
-- src/lib/auth/permissions-shared.ts) but is included below for consistency
-- — harmless, and keeps the stored row coherent with what admin already has.
--
-- Safety / idempotency: each UPDATE only appends when orders.view is present
-- AND the target permission is not already present, so re-running this file
-- (or applying it after someone has since granted rma.* by hand via the Roles
-- editor) is a no-op. No new columns/tables; nothing to enforce or scope.
--
-- Rollback: for any role where this migration was the only source of the
-- grant, `UPDATE roles SET permissions = array_remove(array_remove(permissions, 'rma.view'), 'rma.manage') WHERE key IN (...)`.
-- Not scripted here since it would also strip a legitimately hand-granted rma.*.
--
-- Verify: `SELECT key, permissions FROM roles WHERE 'orders.view' = ANY(permissions);`
-- — every row should now also carry rma.view and rma.manage.

BEGIN;

UPDATE roles
   SET permissions = permissions || ARRAY['rma.view']::text[],
       updated_at = now()
 WHERE 'orders.view' = ANY(permissions)
   AND NOT ('rma.view' = ANY(permissions));

UPDATE roles
   SET permissions = permissions || ARRAY['rma.manage']::text[],
       updated_at = now()
 WHERE 'orders.view' = ANY(permissions)
   AND NOT ('rma.manage' = ANY(permissions));

COMMIT;
