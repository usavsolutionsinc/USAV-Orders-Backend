/**
 * Cross-org isolation test harness (Phase A4).
 *
 * Reusable building blocks for the regression suite that proves a second
 * tenant cannot read/write a first tenant's rows. Every table enforced in
 * Phase E gets a spec built on these helpers (acceptance criterion E4).
 *
 * Two layers are tested separately because they fail for different reasons:
 *
 *   1. APPLICATION layer — the hand-written `WHERE organization_id = $n`
 *      filter. Provable today against any pool (see db.test.ts).
 *
 *   2. DATABASE layer (RLS) — the backstop that makes a *forgotten* filter
 *      non-fatal. Only meaningful when the connection role does NOT have
 *      BYPASSRLS. neondb_owner has BYPASSRLS (so FORCE is inert for it);
 *      the RLS proofs therefore require a non-bypass app role, supplied via
 *      TENANT_APP_DATABASE_URL. Without it, the RLS proofs SKIP (documented).
 *
 * Nothing here drops shared tables or deletes the synthetic orgs — concurrent
 * test runs may share them.
 */

import type { Pool } from 'pg';
import { USAV_ORG_ID } from './constants';

export const TEST_ORG_A = '00000000-0000-0000-0000-0000000000aa';
export const TEST_ORG_B = '00000000-0000-0000-0000-0000000000bb';

/** Idempotently create the two synthetic test orgs. */
export async function ensureTestOrgs(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO organizations (id, slug, name, plan)
     VALUES ($1,'test-iso-a','Test Iso A','trial'),
            ($2,'test-iso-b','Test Iso B','trial')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG_A, TEST_ORG_B],
  );
}

/**
 * Returns a pg Pool connected under the NON-bypassrls application role, or
 * null when TENANT_APP_DATABASE_URL is not configured (so RLS proofs can skip
 * cleanly rather than false-fail under the bypass owner role).
 */
export async function appRolePool(): Promise<Pool | null> {
  const url = process.env.TENANT_APP_DATABASE_URL;
  if (!url) return null;
  const { Pool: PgPool } = await import('pg');
  return new PgPool({ connectionString: url, max: 2 });
}

/** True when the role behind `pool` is subject to RLS (not a bypass/superuser). */
export async function roleIsRlsSubject(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ bypass: boolean; super: boolean }>(
    `SELECT rolbypassrls AS bypass, rolsuper AS super FROM pg_roles WHERE rolname = current_user`,
  );
  return !!rows[0] && !rows[0].bypass && !rows[0].super;
}

/**
 * Invariant: if any table is FORCEd, the live connection role must be an RLS
 * subject — otherwise FORCE is decorative. Returns a human message describing
 * the state (caller asserts on it). Always SAFE today (0 FORCEd).
 */
export async function enforcedRoleInvariant(
  pool: Pool,
): Promise<{ ok: boolean; forcedCount: number; role: string; bypass: boolean }> {
  const { rows: f } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relforcerowsecurity`,
  );
  const { rows: r } = await pool.query<{ current_user: string; bypass: boolean }>(
    `SELECT current_user, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
  );
  const forcedCount = Number(f[0]?.n ?? 0);
  const bypass = !!r[0]?.bypass;
  return { ok: !(forcedCount > 0 && bypass), forcedCount, role: r[0]!.current_user, bypass };
}

/**
 * Proof that RLS itself (not the app filter) isolates tenants. Creates a
 * scratch table that mimics the enforced pattern, FORCEs it, inserts a row for
 * each org via the tenant GUC, then SELECTs with NO org filter under each org
 * and asserts only that org's row is visible. MUST be run against a non-bypass
 * pool to be meaningful.
 *
 * Returns the visible-row counts; the caller asserts {a:1,b:1,crossA:0}.
 */
export async function proveRlsIsolatesScratch(
  pool: Pool,
): Promise<{ ownA: number; ownB: number; crossFromB: number; loudFail: boolean }> {
  const setGuc = (c: { query: (t: string, p?: unknown[]) => Promise<unknown> }, org: string) =>
    c.query(`SELECT set_config('app.current_org',$1,false)`, [org]);

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _tenant_rls_probe (
        id bigserial PRIMARY KEY,
        organization_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
        label text NOT NULL
      )`);
    await client.query(`ALTER TABLE _tenant_rls_probe ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE _tenant_rls_probe FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON _tenant_rls_probe`);
    await client.query(
      `CREATE POLICY tenant_isolation ON _tenant_rls_probe
         USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
         WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)`,
    );

    await setGuc(client, TEST_ORG_A);
    await client.query(`DELETE FROM _tenant_rls_probe`); // only A's rows visible to delete
    await client.query(`INSERT INTO _tenant_rls_probe (label) VALUES ('rls-a')`);
    await setGuc(client, TEST_ORG_B);
    await client.query(`DELETE FROM _tenant_rls_probe`);
    await client.query(`INSERT INTO _tenant_rls_probe (label) VALUES ('rls-b')`);

    // No WHERE filter — isolation must come entirely from RLS.
    await setGuc(client, TEST_ORG_A);
    const a = await client.query(`SELECT count(*)::int AS n FROM _tenant_rls_probe`);
    await setGuc(client, TEST_ORG_B);
    const b = await client.query(`SELECT count(*)::int AS n FROM _tenant_rls_probe`);
    // Cross read: as B, try to see A's labelled row explicitly.
    const cross = await client.query(`SELECT count(*)::int AS n FROM _tenant_rls_probe WHERE label='rls-a'`);

    // Loud-fail: insert with the GUC cleared must violate the policy/NOT NULL.
    let loudFail = false;
    await client.query(`SELECT set_config('app.current_org','',false)`);
    try {
      await client.query(`INSERT INTO _tenant_rls_probe (label) VALUES ('rls-orphan')`);
    } catch {
      loudFail = true;
    }

    return {
      ownA: a.rows[0].n,
      ownB: b.rows[0].n,
      crossFromB: cross.rows[0].n,
      loudFail,
    };
  } finally {
    // Best-effort cleanup of our rows under whichever org is current.
    try {
      await client.query(`SELECT set_config('app.current_org',$1,false)`, [TEST_ORG_A]);
      await client.query(`DELETE FROM _tenant_rls_probe`);
      await client.query(`SELECT set_config('app.current_org',$1,false)`, [TEST_ORG_B]);
      await client.query(`DELETE FROM _tenant_rls_probe`);
    } catch {
      /* ignore */
    }
    client.release();
  }
}

/**
 * Read-only proof that RLS isolates an EXISTING FORCEd table under a non-bypass
 * role, WITHOUT needing CREATE (the runtime `app_tenant` role correctly lacks
 * CREATE on `public`, so `proveRlsIsolatesScratch` cannot run there). Counts
 * rows under the populated org's GUC (expects > 0) and under a different org's
 * GUC (expects 0) — isolation comes entirely from the `tenant_isolation` policy
 * (no WHERE filter). Fully read-only: runs in a transaction it always ROLLBACKs.
 *
 * `table` is a trusted constant supplied by the caller (validated via the
 * `::regclass` cast, which throws on a bad name) — not user input.
 *
 * Returns `{ forced:false }` when the table isn't FORCEd yet so the canary can
 * skip cleanly (a slice not yet promoted), mirroring the self-arming pattern of
 * the reason_codes spec.
 */
export async function proveRlsIsolatesForcedTable(
  pool: Pool,
  table: string,
  populatedOrg: string = USAV_ORG_ID,
  otherOrg: string = TEST_ORG_B,
): Promise<{ forced: boolean; own: number; cross: number }> {
  const f = await pool.query<{ forced: boolean }>(
    `SELECT relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  if (!f.rows[0]?.forced) return { forced: false, own: 0, cross: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org',$1,true)`, [populatedOrg]);
    const own = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    await client.query(`SELECT set_config('app.current_org',$1,true)`, [otherOrg]);
    const cross = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return { forced: true, own: own.rows[0].n, cross: cross.rows[0].n };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
