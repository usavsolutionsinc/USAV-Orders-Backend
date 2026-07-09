import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrgId } from '@/lib/tenancy/constants';
import { getActiveReasonCodes, updateReasonCode } from './reason-codes-queries';

/**
 * Cross-org isolation for the Class-D reason resolver (D1). getActiveReasonCodes
 * reads through tenantQuery (GUC app.current_org) AND filters organization_id —
 * one org must never see another's substitution vocabulary. DB-gated: skips when
 * DATABASE_URL is absent (mirrors tenancy/idor-regression.test.ts).
 */

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_A: OrgId = '00000000-0000-0000-0000-00000000fa01';
const ORG_B: OrgId = '00000000-0000-0000-0000-00000000fb02';
const CODE_A = 'ISO_SUBST_A';
const CODE_B = 'ISO_SUBST_B';

test('getActiveReasonCodes isolates the substitution vocabulary per org', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');

  await pool.query(
    `INSERT INTO organizations (id, slug, name, plan)
       VALUES ($1, 'rc-iso-a', 'RC Iso A', 'trial'), ($2, 'rc-iso-b', 'RC Iso B', 'trial')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_A, ORG_B],
  );
  await pool.query(
    `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context)
       VALUES ($1, $3, 'Iso A only', NULL, 'either', 'substitution'),
              ($2, $4, 'Iso B only', NULL, 'either', 'substitution')
     ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
    [ORG_A, ORG_B, CODE_A, CODE_B],
  );

  const aCodes = (await getActiveReasonCodes(ORG_A, { flowContext: 'substitution' })).map((r) => r.code);
  const bCodes = (await getActiveReasonCodes(ORG_B, { flowContext: 'substitution' })).map((r) => r.code);

  assert.ok(aCodes.includes(CODE_A), 'org A sees its own substitution reason');
  assert.ok(!aCodes.includes(CODE_B), 'org A must NOT see org B reason (tenant isolation)');
  assert.ok(bCodes.includes(CODE_B), 'org B sees its own substitution reason');
  assert.ok(!bCodes.includes(CODE_A), 'org B must NOT see org A reason (tenant isolation)');

  // The flow_context discriminator must scope the result to substitution only.
  const aRows = await getActiveReasonCodes(ORG_A, { flowContext: 'substitution' });
  assert.ok(aRows.length > 0 && aRows.every((r) => r.flow_context === 'substitution'),
    'only substitution-vocabulary rows are returned');
});

test('getActiveReasonCodes scopes a node-bound reason via applies_to (D3)', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  await pool.query(
    `INSERT INTO organizations (id, slug, name, plan) VALUES ($1, 'rc-iso-a', 'RC Iso A', 'trial') ON CONFLICT (id) DO NOTHING`,
    [ORG_A],
  );
  // A node-scoped substitution reason + the global built-ins seeded for ORG_A.
  await pool.query(
    `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context, applies_to)
       VALUES ($1, 'ISO_NODE_SCOPED', 'Node scoped', NULL, 'either', 'substitution', '["nodeX"]'::jsonb)
     ON CONFLICT (organization_id, flow_context, code) DO NOTHING`,
    [ORG_A],
  );

  const atX = (await getActiveReasonCodes(ORG_A, { flowContext: 'substitution', workflowNodeId: 'nodeX' })).map((r) => r.code);
  const atY = (await getActiveReasonCodes(ORG_A, { flowContext: 'substitution', workflowNodeId: 'nodeY' })).map((r) => r.code);

  assert.ok(atX.includes('ISO_NODE_SCOPED'), 'node-scoped reason shows at its node');
  assert.ok(atX.includes('CUSTOMER_REQUEST'), 'global reasons still show at the node');
  assert.ok(!atY.includes('ISO_NODE_SCOPED'), 'node-scoped reason is hidden at other nodes');
  assert.ok(atY.includes('CUSTOMER_REQUEST'), 'global reasons show at every node');
});

test('updateReasonCode sets, clears, and leaves applies_to untouched (D4 write path)', { skip: !HAS_DB }, async () => {
  const { default: pool } = await import('@/lib/db');
  await pool.query(
    `INSERT INTO organizations (id, slug, name, plan) VALUES ($1, 'rc-iso-a', 'RC Iso A', 'trial') ON CONFLICT (id) DO NOTHING`,
    [ORG_A],
  );
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO reason_codes (organization_id, code, label, category, direction, flow_context)
       VALUES ($1, 'ISO_UPD_APPLIES', 'Upd applies', NULL, 'either', 'substitution')
     ON CONFLICT (organization_id, flow_context, code) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [ORG_A],
  );
  const id = ins.rows[0].id;

  const set = await updateReasonCode(id, { appliesTo: ['nodeZ'] }, ORG_A);
  assert.deepEqual(set?.applies_to, ['nodeZ'], 'applies_to set to the node array');

  const cleared = await updateReasonCode(id, { appliesTo: null }, ORG_A);
  assert.equal(cleared?.applies_to, null, 'applies_to cleared to global (null)');

  await updateReasonCode(id, { appliesTo: ['nodeQ'] }, ORG_A);
  const untouched = await updateReasonCode(id, { label: 'Renamed' }, ORG_A);
  assert.deepEqual(untouched?.applies_to, ['nodeQ'], 'omitting appliesTo leaves it untouched');
});
