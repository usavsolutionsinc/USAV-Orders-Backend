/**
 * Cross-org isolation regression suite (Phase A4 / E4).
 *
 * Tiered so it can live in CI now and tighten as Phase E rolls out:
 *
 *   - Always (with DATABASE_URL): the enforced-role INVARIANT — if any table is
 *     FORCEd, the connection role must not have BYPASSRLS. Passes today (0 FORCEd).
 *   - With TENANT_APP_DATABASE_URL (the non-bypass app_tenant role): the RLS
 *     CANARY — RLS itself isolates a scratch table with no WHERE filter, and a
 *     GUC-cleared insert loud-fails. This is the objective proof that the role
 *     flip succeeded; it gates enforce_tenant_isolation().
 *
 * Both skip cleanly when their prerequisite env var is absent.
 */

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import {
  ensureTestOrgs,
  appRolePool,
  enforcedRoleInvariant,
  proveRlsIsolatesScratch,
} from './cross-org-harness';

const HAS_DB = !!process.env.DATABASE_URL;
const HAS_APP_ROLE = !!process.env.TENANT_APP_DATABASE_URL;

test('enforced-role invariant: no FORCEd table under a BYPASSRLS role', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const inv = await enforcedRoleInvariant(pool as any);
  ok(
    inv.ok,
    `role '${inv.role}' has BYPASSRLS=${inv.bypass} while ${inv.forcedCount} table(s) are FORCEd — ` +
      `FORCE is inert under a bypass role. Flip the app to a non-bypassrls role (Phase E1).`,
  );
});

test('RLS canary: policy isolates without a WHERE filter (needs app_tenant role)', { skip: !HAS_APP_ROLE }, async () => {
  const pool = await appRolePool();
  ok(pool, 'TENANT_APP_DATABASE_URL must resolve to a pool');
  try {
    await ensureTestOrgs(pool!);
    const r = await proveRlsIsolatesScratch(pool!);
    strictEqual(r.ownA, 1, 'org A sees exactly its own row');
    strictEqual(r.ownB, 1, 'org B sees exactly its own row');
    strictEqual(r.crossFromB, 0, "org B must see 0 of org A's rows (RLS, no WHERE filter)");
    ok(r.loudFail, 'insert with the GUC cleared must fail (loud-fail default / policy)');
  } finally {
    await pool!.end();
  }
});
