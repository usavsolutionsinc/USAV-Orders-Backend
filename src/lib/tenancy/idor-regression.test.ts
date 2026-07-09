/**
 * IDOR-by-global-id regression tests (Bucket 1).
 *
 * The leak class RLS CANNOT catch: a helper that takes an id and acts on it
 * must verify the row belongs to the caller's org. These prove the 2026-06-27
 * fixes reject cross-org access at the data layer — and fail loudly if anyone
 * removes an `organization_id` predicate later.
 *
 * `staff` is the important case: it has NO RLS, so the explicit predicate is the
 * ONLY guard — RLS would not save us. (suppliers / work_assignments are FORCEd,
 * so they're double-protected; the test still pins the predicate.)
 *
 * DB-gated like db.test.ts (skips without DATABASE_URL); self-cleaning.
 */

import 'dotenv/config'; // load .env before the HAS_DB check (db.ts loads it too, but later)
import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

async function ensureOrgs(pool: { query: (t: string, p?: unknown[]) => Promise<unknown> }) {
  await pool.query(
    `INSERT INTO organizations (id, slug, name, plan)
       VALUES ($1, 'idor-iso-a', 'IDOR Iso A', 'trial'),
              ($2, 'idor-iso-b', 'IDOR Iso B', 'trial')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
}

test('IDOR: setStaffPin/verifyStaffPin reject cross-org (staff has NO RLS — predicate is the only guard)', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const { setStaffPin, verifyStaffPin, PinError } = await import('@/lib/auth/pin');
  await ensureOrgs(pool);
  await pool.query(`DELETE FROM staff WHERE name LIKE 'idor-test-%'`);
  const ins = await pool.query(
    `INSERT INTO staff (organization_id, name, role) VALUES ($1, 'idor-test-b', 'tech') RETURNING id`,
    [ORG_B],
  );
  const staffB = (ins.rows[0] as { id: number }).id;

  try {
    // C1: org A admin tries to reset org B staff's PIN → must be a no-op.
    await setStaffPin(staffB, '4729', ORG_A);
    const a1 = await pool.query(`SELECT pin_hash FROM staff WHERE id = $1`, [staffB]);
    ok((a1.rows[0] as { pin_hash: string | null }).pin_hash == null, 'cross-org setStaffPin must NOT set a PIN');

    // Same-org reset works.
    await setStaffPin(staffB, '4729', ORG_B);
    const a2 = await pool.query(`SELECT pin_hash FROM staff WHERE id = $1`, [staffB]);
    ok((a2.rows[0] as { pin_hash: string | null }).pin_hash != null, 'same-org setStaffPin must set the PIN');

    // M1/C1: cross-org verify → NOT_FOUND (never reveals the row or validates).
    let threw = false;
    try {
      await verifyStaffPin(staffB, '4729', ORG_A);
    } catch (err) {
      threw = err instanceof PinError && err.code === 'NOT_FOUND';
    }
    ok(threw, 'cross-org verifyStaffPin must throw NOT_FOUND');

    // Same-org verify succeeds.
    const row = await verifyStaffPin(staffB, '4729', ORG_B);
    strictEqual(row.id, staffB);
  } finally {
    await pool.query(`DELETE FROM staff WHERE name LIKE 'idor-test-%'`);
  }
});

test('IDOR: pin/create route rejects a staffId from another tenant (x-tenant-slug scope)', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const { POST } = await import('@/app/api/auth/pin/create/route');
  await ensureOrgs(pool);
  await pool.query(`DELETE FROM staff WHERE name LIKE 'idor-test-%'`);
  // Unenrolled (pin_hash NULL) staff in org B.
  const ins = await pool.query(
    `INSERT INTO staff (organization_id, name, role) VALUES ($1, 'idor-test-b2', 'tech') RETURNING id`,
    [ORG_B],
  );
  const staffB = (ins.rows[0] as { id: number }).id;
  try {
    // Request carries org A's tenant slug but targets org B's staff → must 404, never enroll.
    const req = new Request('http://localhost/api/auth/pin/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-slug': 'idor-iso-a' },
      body: JSON.stringify({ staffId: staffB, pin: '4729' }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    strictEqual(res.status, 404, 'cross-tenant pin/create must 404');
    const after = await pool.query(`SELECT pin_hash FROM staff WHERE id = $1`, [staffB]);
    ok((after.rows[0] as { pin_hash: string | null }).pin_hash == null, 'cross-tenant pin/create must NOT enroll the staff');
  } finally {
    await pool.query(`DELETE FROM staff WHERE name LIKE 'idor-test-%'`);
  }
});

test('IDOR: assignments queries reject cross-org read/update/delete', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const { createAssignment, getAssignmentById, updateAssignment, deleteAssignment } =
    await import('@/lib/neon/assignments-queries');
  await ensureOrgs(pool);
  await pool.query(`DELETE FROM work_assignments WHERE entity_id = 990000777`);

  const created = await createAssignment({
    organizationId: ORG_B, entityType: 'ORDER', entityId: 990000777, workType: 'TEST',
  });
  try {
    // C4: org A cannot see / mutate org B's assignment.
    strictEqual(await getAssignmentById(created.id, ORG_A), null, 'cross-org read must return null');
    strictEqual(await updateAssignment(created.id, { status: 'DONE' }, ORG_A), null, 'cross-org update must be a no-op');
    strictEqual(await deleteAssignment(created.id, ORG_A), false, 'cross-org delete must be a no-op');
    // Org B can.
    ok(await getAssignmentById(created.id, ORG_B), 'same-org read works');
    ok(await deleteAssignment(created.id, ORG_B), 'same-org delete works');
  } finally {
    await pool.query(`DELETE FROM work_assignments WHERE entity_id = 990000777`);
  }
});

test('IDOR: warranty mutations reject cross-org (run on owner pool — predicate is the only guard)', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const { updateClaimMeta, submitClaim, revertClaimStatus, restoreClaims } =
    await import('@/lib/warranty/mutations');
  await ensureOrgs(pool);
  await pool.query(`DELETE FROM warranty_claims WHERE claim_number LIKE 'WC-IDOR-%'`);

  // Seed two LOGGED claims owned by org B (minimal columns; status defaults but
  // we set it explicitly), plus one soft-deleted claim for the restore probe.
  const seed = async (claimNo: string, deleted = false) => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO warranty_claims (organization_id, claim_number, status, product_title, deleted_at)
         VALUES ($1, $2, 'LOGGED', 'orig-title', ${deleted ? 'NOW()' : 'NULL'})
       RETURNING id`,
      [ORG_B, claimNo],
    );
    return Number(rows[0].id); // bigint comes back as a string; routes pass parsed numbers
  };
  const metaId = await seed('WC-IDOR-META');
  const submitId = await seed('WC-IDOR-SUBMIT');
  const restoreId = await seed('WC-IDOR-RESTORE', true);

  const statusOf = async (id: number) =>
    ((await pool.query(`SELECT status FROM warranty_claims WHERE id = $1`, [id])).rows[0] as { status: string }).status;
  const titleOf = async (id: number) =>
    ((await pool.query(`SELECT product_title FROM warranty_claims WHERE id = $1`, [id])).rows[0] as { product_title: string }).product_title;
  const deletedOf = async (id: number) =>
    ((await pool.query(`SELECT deleted_at FROM warranty_claims WHERE id = $1`, [id])).rows[0] as { deleted_at: string | null }).deleted_at;

  try {
    // updateClaimMeta: cross-org → 404 + row unchanged; same-org → row changed.
    const metaA = await updateClaimMeta(metaId, { productTitle: 'hacked' }, null, ORG_A);
    strictEqual(metaA.ok, false, 'cross-org updateClaimMeta must fail');
    strictEqual(await titleOf(metaId), 'orig-title', 'cross-org updateClaimMeta must NOT change the row');
    await updateClaimMeta(metaId, { productTitle: 'legit' }, null, ORG_B);
    strictEqual(await titleOf(metaId), 'legit', 'same-org updateClaimMeta must change the row');

    // submitClaim (transition): cross-org → 404 + status unchanged; same-org advances.
    const subA = await submitClaim(submitId, null, ORG_A);
    strictEqual(subA.ok, false, 'cross-org submitClaim must fail');
    strictEqual(await statusOf(submitId), 'LOGGED', 'cross-org submitClaim must NOT advance status');
    await submitClaim(submitId, null, ORG_B);
    strictEqual(await statusOf(submitId), 'SUBMITTED', 'same-org submitClaim must advance status');

    // revertClaimStatus: cross-org → 404 (status stays SUBMITTED).
    const revA = await revertClaimStatus(submitId, null, ORG_A);
    strictEqual(revA.ok, false, 'cross-org revertClaimStatus must fail');
    strictEqual(await statusOf(submitId), 'SUBMITTED', 'cross-org revert must NOT change status');

    // restoreClaims: cross-org → notFound + still deleted; same-org un-tombstones.
    const restA = await restoreClaims([restoreId], null, ORG_A);
    ok(restA.notFound.includes(restoreId), 'cross-org restore must report notFound');
    ok((await deletedOf(restoreId)) != null, 'cross-org restore must NOT un-delete');
    const restB = await restoreClaims([restoreId], null, ORG_B);
    ok(restB.restored.some((r) => r.id === restoreId), 'same-org restore works');
    ok((await deletedOf(restoreId)) == null, 'same-org restore un-deletes');
  } finally {
    await pool.query(`DELETE FROM warranty_claims WHERE claim_number LIKE 'WC-IDOR-%'`);
  }
});

test('IDOR: suppliers queries reject cross-org read/update/delete', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  const { createSupplier, getSupplierById, updateSupplier, softDeleteSupplier } =
    await import('@/lib/neon/suppliers-queries');
  await ensureOrgs(pool);
  await pool.query(`DELETE FROM suppliers WHERE name = 'idor-test-supplier'`);

  const supplier = await createSupplier({ name: 'idor-test-supplier' }, ORG_B);
  try {
    // H1: org A cannot see / mutate org B's supplier.
    strictEqual(await getSupplierById(supplier.id, ORG_A), null, 'cross-org read must return null');
    strictEqual(await updateSupplier(supplier.id, { notes: 'x' }, ORG_A), null, 'cross-org update must be a no-op');
    strictEqual(await softDeleteSupplier(supplier.id, ORG_A), null, 'cross-org soft-delete must be a no-op');
    // Org B can.
    ok(await getSupplierById(supplier.id, ORG_B), 'same-org read works');
  } finally {
    await pool.query(`DELETE FROM suppliers WHERE name = 'idor-test-supplier'`);
  }
});
