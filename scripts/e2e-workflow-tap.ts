/**
 * E2E test: workflow-engine tap against the REAL seeded graph
 * ("Standard refurb-and-list" v1, src/lib/migrations/2026-06-11b_*.sql).
 *
 * The Phase-1 exit test: prove that the production tap path — enrollment at
 * the entry node, event-gated advances, the fail→repair→re-test loop, and
 * the terminal ship — works end to end against the live workflow tables,
 * not just the in-memory harness (station-nodes.test.ts covers that).
 *
 * Creates ONE clearly-marked serial unit (WFTAP-E2E-<pid>), walks it through
 * the graph via tapWorkflow() (the exact function the receiving/test/repair
 * call sites invoke), asserts item_workflow_state after every step, then
 * deletes the unit (item_workflow_state cascades) and its workflow_runs rows.
 *
 *   npx tsx scripts/e2e-workflow-tap.ts
 */

import assert from 'node:assert/strict';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

const USAV_ORG = '00000000-0000-0000-0000-000000000001';
const SERIAL = `WFTAP-E2E-${process.pid}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

async function main() {
  // Import AFTER dotenv so @/lib/drizzle/db sees DATABASE_URL.
  const { Pool } = await import('pg');
  const { tapWorkflow } = await import('../src/lib/workflow/tap');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const unitRes = await pool.query<{ id: number }>(
    `INSERT INTO serial_units (serial_number, normalized_serial, current_status, origin_source)
     VALUES ($1, $1, 'RECEIVED', 'receiving')
     RETURNING id`,
    [SERIAL],
  );
  const unitId = unitRes.rows[0].id;
  console.log(`unit ${unitId} (${SERIAL}) created`);

  const position = async () => {
    const r = await pool.query<{ current_node_id: string; status: string }>(
      `SELECT current_node_id, status FROM item_workflow_state WHERE serial_unit_id = $1`,
      [unitId],
    );
    return r.rows[0] ?? null;
  };

  try {
    // 1. Receiving tap: enrolls at the entry node and advances through 'received'.
    await tapWorkflow({ serialUnitId: unitId, event: 'unit_received', orgId: USAV_ORG, staffId: null });
    let pos = await position();
    assert.equal(pos?.current_node_id, 'refurb-v1-test-grade', 'after scan: at test-grade');
    console.log('✔ scan-in enrolled + advanced → test-grade');

    // 2. Re-scan replay: parks, never double-advances.
    await tapWorkflow({ serialUnitId: unitId, event: 'unit_received', orgId: USAV_ORG, staffId: null });
    pos = await position();
    assert.equal(pos?.current_node_id, 'refurb-v1-test-grade', 'replay did not move the unit');
    console.log('✔ re-scan replay parked (idempotent)');

    // 3. Fail verdict → repair lane.
    await tapWorkflow({
      serialUnitId: unitId, event: 'test_verdict', input: { verdict: 'TESTING_FAILED' }, staffId: null,
    });
    pos = await position();
    assert.equal(pos?.current_node_id, 'refurb-v1-repair', 'fail routed to repair');
    console.log('✔ fail verdict → repair');

    // 4. Repair completion → back to the bench.
    await tapWorkflow({
      serialUnitId: unitId, event: 'repair_completed', input: { repairId: -1 }, staffId: null,
    });
    pos = await position();
    assert.equal(pos?.current_node_id, 'refurb-v1-test-grade', 'repaired loops to re-test');
    console.log('✔ repair completed → re-test');

    // 5. Pass → list → pack → ship → done.
    await tapWorkflow({ serialUnitId: unitId, event: 'test_verdict', input: { verdict: 'PASS' }, staffId: null });
    pos = await position();
    assert.equal(pos?.current_node_id, 'refurb-v1-list-ebay', 'pass routed to listing');

    await tapWorkflow({ serialUnitId: unitId, event: 'listed', staffId: null });
    await tapWorkflow({ serialUnitId: unitId, event: 'packed', staffId: null });
    await tapWorkflow({ serialUnitId: unitId, event: 'shipped', staffId: null });
    pos = await position();
    assert.equal(pos?.status, 'done', 'shipped is terminal');
    console.log('✔ pass → listed → packed → shipped → done');

    const runs = await pool.query<{ node_type: string; output: string | null }>(
      `SELECT node_type, output FROM workflow_runs WHERE serial_unit_id = $1 ORDER BY id`,
      [unitId],
    );
    console.log(
      'runs:',
      runs.rows.map((r) => `${r.node_type}:${r.output}`).join(' → '),
    );

    console.log('PASS — workflow tap e2e green');
  } finally {
    await pool.query(`DELETE FROM workflow_runs WHERE serial_unit_id = $1`, [unitId]);
    await pool.query(`DELETE FROM serial_units WHERE id = $1`, [unitId]); // cascades item_workflow_state
    await pool.end();
    console.log('cleanup done');
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
