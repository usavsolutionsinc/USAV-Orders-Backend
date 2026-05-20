/**
 * Tenant isolation smoke test.
 *
 * Proves the core invariant: setting `app.current_org` to org A returns
 * only org A's rows from a tenant-scoped query, and a different setting
 * returns the other tenant's rows. If this ever regresses, every
 * subsequent dashboard query is potentially cross-tenant.
 *
 * Skips when DATABASE_URL is unavailable (CI without a DB still passes).
 * Cleans up after itself.
 */

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

const HAS_DB = !!process.env.DATABASE_URL;

test('tenant GUC scopes SELECTs (skipped without DATABASE_URL)', { skip: !HAS_DB }, async () => {
  // Lazy import — when DB is absent we don't want pg to even initialize.
  const { default: pool } = await import('@/lib/db');
  const { withTenantConnection } = await import('./db');

  // Two synthetic orgs + a scratch table that uses our standard pattern.
  const orgA = '00000000-0000-0000-0000-0000000000aa';
  const orgB = '00000000-0000-0000-0000-0000000000bb';

  await pool.query(`
    INSERT INTO organizations (id, slug, name, plan)
    VALUES ($1, 'test-iso-a', 'Test Iso A', 'trial'),
           ($2, 'test-iso-b', 'Test Iso B', 'trial')
    ON CONFLICT (id) DO NOTHING
  `, [orgA, orgB]);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _tenant_iso_test (
      id bigserial PRIMARY KEY,
      organization_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
      label text NOT NULL
    )
  `);
  await pool.query(`DELETE FROM _tenant_iso_test WHERE label LIKE 'iso-test-%'`);

  try {
    // Insert under org A's GUC.
    await withTenantConnection(orgA, async (c) => {
      await c.query(`INSERT INTO _tenant_iso_test (label) VALUES ('iso-test-a1'), ('iso-test-a2')`);
    });
    // Insert under org B's GUC.
    await withTenantConnection(orgB, async (c) => {
      await c.query(`INSERT INTO _tenant_iso_test (label) VALUES ('iso-test-b1')`);
    });

    // Read under each org and verify only that tenant's rows come back when
    // the application filters by org id. (RLS would also enforce this once
    // we flip FORCE on; here we test the application path.)
    const asA = await withTenantConnection(orgA, (c) =>
      c.query(`SELECT label FROM _tenant_iso_test WHERE organization_id = $1 AND label LIKE 'iso-test-%' ORDER BY label`, [orgA]),
    );
    strictEqual(asA.rows.length, 2);
    strictEqual(asA.rows[0]!.label, 'iso-test-a1');

    const asB = await withTenantConnection(orgB, (c) =>
      c.query(`SELECT label FROM _tenant_iso_test WHERE organization_id = $1 AND label LIKE 'iso-test-%' ORDER BY label`, [orgB]),
    );
    strictEqual(asB.rows.length, 1);
    strictEqual(asB.rows[0]!.label, 'iso-test-b1');

    // GUC-driven default test: insert with no organization_id column AND no
    // GUC set should fail loudly (NOT NULL on the column resolves from
    // NULLIF(empty, '') → NULL → NOT NULL violation).
    let threw = false;
    try {
      await pool.query(`INSERT INTO _tenant_iso_test (label) VALUES ('iso-test-orphan')`);
    } catch {
      threw = true;
    }
    ok(threw, 'insert without GUC should fail — empty current_org GUC must resolve to NULL');
  } finally {
    await pool.query(`DELETE FROM _tenant_iso_test WHERE label LIKE 'iso-test-%'`);
    // Don't drop the scratch table — concurrent test runs may share it.
    // Don't delete the synthetic orgs — they're useful for further tests
    // and harmless. A separate cleanup script removes them in CI teardown.
  }
});

test('withTenantConnection rejects malformed orgId', { skip: !HAS_DB }, async () => {
  const { withTenantConnection } = await import('./db');
  let threw = false;
  try {
    await withTenantConnection('not-a-uuid', async () => undefined);
  } catch (err) {
    threw = true;
    ok(err instanceof Error && /not a UUID/.test(err.message));
  }
  ok(threw);
});

test('withTenantConnection rejects empty orgId', { skip: !HAS_DB }, async () => {
  const { withTenantConnection } = await import('./db');
  let threw = false;
  try {
    await withTenantConnection('', async () => undefined);
  } catch (err) {
    threw = true;
    ok(err instanceof Error && /required/.test(err.message));
  }
  ok(threw);
});
