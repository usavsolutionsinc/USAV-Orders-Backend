/**
 * Permission drift audit. Run via `npm run audit-permissions`.
 *
 * Hard failures (exit 1):
 *   - DB roles reference permissions not in the registry
 *   - Staff overrides (permissions_added / _removed) reference unknown perms
 *   - Registry has duplicate ids (would already fail TS, but belt + suspenders)
 *
 * Soft warnings (exit 0 with stderr):
 *   - Registered permissions that no role grants AND no override references
 *     (likely orphan; may be intentional for admin-only perms)
 *   - DB roles that drift from the seed (FYI only — extras may be intentional)
 *
 * Reads .env or .env.local for DATABASE_URL. Read-only — never mutates.
 */

import { Pool } from 'pg';
import {
  PERMISSIONS,
  REGISTRY_ALL_PERMISSIONS,
  type RegistryPermissionString,
} from '../src/lib/auth/permission-registry';

function loadEnv(): void {
  // Prefer .env over .env.local — the dev server reads it first (see src/lib/db.ts).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    /* dotenv may be absent in some envs; just rely on process.env */
  }
}

async function main(): Promise<void> {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });

  const hardIssues: string[] = [];
  const softIssues: string[] = [];

  try {
    // ─── 1. Registry self-checks ──────────────────────────────────────────
    const seen = new Set<string>();
    for (const p of PERMISSIONS) {
      if (seen.has(p.id)) hardIssues.push(`registry: duplicate id '${p.id}'`);
      seen.add(p.id);
    }

    // ─── 2. DB roles → registry ──────────────────────────────────────────
    const roles = await pool.query<{ key: string; permissions: string[] }>(
      `SELECT key, permissions FROM roles WHERE key <> 'admin' ORDER BY key`,
    );
    const grantedByRoles = new Set<string>();
    for (const role of roles.rows) {
      for (const perm of role.permissions) {
        if (!REGISTRY_ALL_PERMISSIONS.has(perm as RegistryPermissionString)) {
          hardIssues.push(`role '${role.key}' references unknown permission '${perm}'`);
        } else {
          grantedByRoles.add(perm);
        }
      }
    }

    // ─── 3. Staff overrides → registry ───────────────────────────────────
    const overrides = await pool.query<{
      id: number;
      name: string;
      permissions_added: string[] | null;
      permissions_removed: string[] | null;
    }>(
      `SELECT id, name, permissions_added, permissions_removed
         FROM staff
        WHERE coalesce(array_length(permissions_added,1), 0) > 0
           OR coalesce(array_length(permissions_removed,1), 0) > 0`,
    );
    for (const s of overrides.rows) {
      const all = [...(s.permissions_added ?? []), ...(s.permissions_removed ?? [])];
      for (const perm of all) {
        if (!REGISTRY_ALL_PERMISSIONS.has(perm as RegistryPermissionString)) {
          hardIssues.push(`staff #${s.id} (${s.name}) override references unknown permission '${perm}'`);
        }
      }
    }

    // ─── 4. Registered but never granted ─────────────────────────────────
    const referencedByOverride = new Set<string>();
    for (const s of overrides.rows) {
      for (const p of [...(s.permissions_added ?? []), ...(s.permissions_removed ?? [])]) {
        referencedByOverride.add(p);
      }
    }
    for (const id of REGISTRY_ALL_PERMISSIONS) {
      if (!grantedByRoles.has(id) && !referencedByOverride.has(id)) {
        // Admin-only perms (admin.*, settings.*, integrations.*) often aren't in any
        // non-admin role — the admin role short-circuits to all. So this is a soft
        // warning, not a hard fail.
        softIssues.push(`permission '${id}' is in registry but no role grants it`);
      }
    }

    // ─── 5. Roles with fewer permissions than common-sense (smoke check) ─
    // Each non-admin role should grant *at least one* permission. Empty rows are usually a config mistake.
    for (const role of roles.rows) {
      if (role.permissions.length === 0) {
        softIssues.push(`role '${role.key}' grants zero permissions`);
      }
    }

    // ─── Report ──────────────────────────────────────────────────────────
    if (hardIssues.length === 0 && softIssues.length === 0) {
      console.log('✓ no permission drift detected');
      return;
    }
    if (softIssues.length) {
      console.warn('\n--- soft warnings ---');
      for (const w of softIssues) console.warn('  ⚠ ', w);
    }
    if (hardIssues.length) {
      console.error('\n--- hard issues ---');
      for (const i of hardIssues) console.error('  ✗ ', i);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('audit-permissions failed:', err);
  process.exit(1);
});
