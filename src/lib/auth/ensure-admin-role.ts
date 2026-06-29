/**
 * WS2.2 — admin-role self-heal.
 *
 * Self-service signup wires the first admin via:
 *
 *   INSERT INTO staff_roles (staff_id, role_id)
 *   SELECT $1, r.id FROM roles r WHERE r.key = 'admin'
 *   ON CONFLICT DO NOTHING
 *
 * That `SELECT … FROM roles WHERE key = 'admin'` silently no-ops on a fresh DB
 * whose GLOBAL `roles` table was never seeded (scripts/seed-roles.mjs never run).
 * The result is an admin staffer with ZERO role assignments — and therefore zero
 * permissions — with no error to signal it.
 *
 * This helper guarantees the invariant "the first admin always ends up with the
 * admin role + permissions": it checks whether the wire landed, and if not, seeds
 * the admin role row (idempotent) and retries the wire.
 *
 * Permission set: we use the LIVE registry SoT (`ALL_PERMISSIONS`) rather than a
 * copied 8-role matrix. Phase 2b deliberately deleted the static
 * `ROLE_PERMISSION_SETS` from `permissions-shared.ts` because it drifted from the
 * DB; the only remaining copy is scripts/seed-roles.mjs (a non-importable script
 * const). Seeding admin with `Array.from(ALL_PERMISSIONS)` is correct by
 * construction and cannot drift. (Admin also short-circuits to all permissions at
 * runtime via `computeEffectivePermissions`, so the stored row is belt-and-braces.)
 * The non-admin system roles are intentionally NOT re-inlined here — that matrix's
 * SoT is scripts/seed-roles.mjs; duplicating it would re-introduce the drift Phase
 * 2b removed. Running seed-roles.mjs remains the way to seed the full taxonomy.
 *
 * Idempotent (ON CONFLICT DO NOTHING throughout) and safe to call inside the
 * signup transaction by passing the transaction client, so it shares the same
 * commit/rollback as the rest of signup.
 */

import type { Pool, PoolClient } from 'pg';
import dbPool from '@/lib/db';
import { ALL_PERMISSIONS, ADMIN_ROLE_KEY } from './permissions-shared';

type Executor = Pool | PoolClient;

async function adminWired(db: Executor, staffId: number): Promise<boolean> {
  const r = await db.query(
    `SELECT 1
       FROM staff_roles sr
       JOIN roles r ON r.id = sr.role_id
      WHERE sr.staff_id = $1 AND r.key = $2
      LIMIT 1`,
    [staffId, ADMIN_ROLE_KEY],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Ensure `staffId` has the admin role wired, seeding the admin role row first if
 * the global `roles` table lacks it. Returns true if the admin-role assignment
 * exists after running.
 */
export async function ensureAdminRoleWired(
  staffId: number,
  db: Executor = dbPool,
): Promise<boolean> {
  // Fast path: the original wire already landed (roles taxonomy was seeded).
  if (await adminWired(db, staffId)) return true;

  // Seed the admin role row (idempotent). Permissions = the full live registry
  // set; metadata mirrors scripts/seed-roles.mjs so the row is coherent with a
  // later full seed.
  const adminPerms = Array.from(ALL_PERMISSIONS);
  await db.query(
    `INSERT INTO roles (key, label, color, position, permissions, is_system)
     VALUES ($1, 'Admin', '#1f2937', 1, $2::text[], true)
     ON CONFLICT (key) DO NOTHING`,
    [ADMIN_ROLE_KEY, adminPerms],
  );

  // Retry the wire now that the admin role is guaranteed to exist.
  await db.query(
    `INSERT INTO staff_roles (staff_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.key = $2
     ON CONFLICT DO NOTHING`,
    [staffId, ADMIN_ROLE_KEY],
  );

  return adminWired(db, staffId);
}
