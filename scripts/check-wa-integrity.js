/**
 * Work-assignments integrity checker
 *
 * Usage:
 *   node scripts/check-wa-integrity.js          # report only
 *   node scripts/check-wa-integrity.js --fix     # report + auto-repair safe issues
 *
 * Checks performed:
 *  1. Duplicate active rows (same entity_type + entity_id + work_type, multiple OPEN/ASSIGNED/IN_PROGRESS)
 *  2. ORDER/TEST rows that have assigned_packer_id set  (must always be NULL)
 *  3. ORDER/PACK rows that have assigned_tech_id set   (must always be NULL)
 *  4. DONE / CANCELED rows missing completed_at
 *  5. ASSIGNED / IN_PROGRESS rows with both assigned_tech_id AND assigned_packer_id NULL
 *  6. Orphaned rows — entity_id has no matching record in the source table
 *  7. Invalid staff IDs — assigned_tech_id or assigned_packer_id not in staff table
 *  8. Ghost DONE PACK rows — ORDER/PACK rows created with status=DONE but null packer (no real assignment)
 *
 * --fix repairs:
 *  - Nulls out the wrong column on ORDER/TEST or ORDER/PACK cross-contamination (check 2 & 3)
 *  - Stamps completed_at = NOW() on DONE/CANCELED rows missing it (check 4)
 *  - Cancels ghost DONE PACK rows (check 8)
 */

require('dotenv').config({ path: '.env', quiet: true });

const { Client } = require('pg');

const FIX_MODE = process.argv.includes('--fix');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  options: '-c timezone=America/Los_Angeles',
});

let totalIssues = 0;

function header(title) {
  console.log('\n' + '─'.repeat(72));
  console.log(`  ${title}`);
  console.log('─'.repeat(72));
}

function ok(msg) {
  console.log(`  ✓  ${msg}`);
}

function issue(msg) {
  totalIssues++;
  console.log(`  ✗  ${msg}`);
}

function fixed(msg) {
  console.log(`  ✔  FIXED: ${msg}`);
}

async function check1_duplicateActiveRows() {
  header('CHECK 1 · Duplicate active rows per entity_type + entity_id + work_type');
  const { rows } = await client.query(`
    SELECT entity_type, entity_id, work_type, COUNT(*) AS cnt,
           array_agg(id ORDER BY id) AS ids,
           array_agg(status ORDER BY id) AS statuses
    FROM work_assignments
    WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
      AND completed_at IS NULL
    GROUP BY entity_type, entity_id, work_type
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, entity_type, entity_id
  `);

  if (rows.length === 0) {
    ok('No duplicate active rows found.');
    return;
  }

  for (const r of rows) {
    issue(
      `${r.entity_type} entity_id=${r.entity_id} work_type=${r.work_type} ` +
      `has ${r.cnt} active rows  ids=[${r.ids}]  statuses=[${r.statuses}]`
    );
  }
  console.log(`\n  ${rows.length} conflict group(s) found.`);
  console.log(
    '  Recommendation: keep the IN_PROGRESS row (or highest-priority ASSIGNED row);\n' +
    '  cancel the rest.  Run with --fix only after manual review.'
  );
}

async function check2_orderTestWithPacker() {
  header('CHECK 2 · ORDER/TEST rows that have assigned_packer_id set (must be NULL)');
  const { rows } = await client.query(`
    SELECT id, entity_id, status, assigned_tech_id, assigned_packer_id
    FROM work_assignments
    WHERE entity_type = 'ORDER'
      AND work_type   = 'TEST'
      AND assigned_packer_id IS NOT NULL
    ORDER BY id
  `);

  if (rows.length === 0) { ok('No contaminated ORDER/TEST rows.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  order_id=${r.entity_id}  status=${r.status}  ` +
      `tech=${r.assigned_tech_id}  packer=${r.assigned_packer_id}  ← packer should be NULL`
    );
  }

  if (FIX_MODE) {
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE work_assignments SET assigned_packer_id = NULL, updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    fixed(`Nulled assigned_packer_id on ${ids.length} ORDER/TEST row(s): [${ids}]`);
  }
}

async function check3_orderPackWithTech() {
  header('CHECK 3 · ORDER/PACK rows that have assigned_tech_id set (must be NULL)');
  const { rows } = await client.query(`
    SELECT id, entity_id, status, assigned_tech_id, assigned_packer_id
    FROM work_assignments
    WHERE entity_type = 'ORDER'
      AND work_type   = 'PACK'
      AND assigned_tech_id IS NOT NULL
    ORDER BY id
  `);

  if (rows.length === 0) { ok('No contaminated ORDER/PACK rows.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  order_id=${r.entity_id}  status=${r.status}  ` +
      `tech=${r.assigned_tech_id}  packer=${r.assigned_packer_id}  ← tech should be NULL`
    );
  }

  if (FIX_MODE) {
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE work_assignments SET assigned_tech_id = NULL, updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    fixed(`Nulled assigned_tech_id on ${ids.length} ORDER/PACK row(s): [${ids}]`);
  }
}

async function check4_doneWithoutCompletedAt() {
  header('CHECK 4 · DONE / CANCELED rows missing completed_at');
  const { rows } = await client.query(`
    SELECT id, entity_type, entity_id, work_type, status, updated_at
    FROM work_assignments
    WHERE status IN ('DONE', 'CANCELED')
      AND completed_at IS NULL
    ORDER BY id
  `);

  if (rows.length === 0) { ok('All DONE/CANCELED rows have completed_at set.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  ${r.entity_type}/${r.work_type}  entity_id=${r.entity_id}  ` +
      `status=${r.status}  completed_at=NULL`
    );
  }

  if (FIX_MODE) {
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE work_assignments
       SET completed_at = COALESCE(updated_at, NOW()), updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    fixed(`Stamped completed_at on ${ids.length} row(s): [${ids}]`);
  }
}

async function check5_assignedWithNoStaff() {
  header('CHECK 5 · ASSIGNED / IN_PROGRESS rows with both tech and packer NULL');
  const { rows } = await client.query(`
    SELECT id, entity_type, entity_id, work_type, status
    FROM work_assignments
    WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
      AND assigned_tech_id   IS NULL
      AND assigned_packer_id IS NULL
    ORDER BY id
  `);

  if (rows.length === 0) { ok('All ASSIGNED/IN_PROGRESS rows have at least one staff member.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  ${r.entity_type}/${r.work_type}  entity_id=${r.entity_id}  ` +
      `status=${r.status}  ← no staff assigned`
    );
  }

  if (FIX_MODE) {
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE work_assignments
       SET status = 'OPEN'::assignment_status_enum, updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    fixed(`Reverted status to OPEN on ${ids.length} staffless row(s): [${ids}]`);
  }
}

async function check6_orphanedRows() {
  header('CHECK 6 · Orphaned rows — entity_id not in source table');

  const checks = [
    {
      entityType: 'ORDER',
      table: 'orders',
      label: 'orders',
    },
    {
      entityType: 'REPAIR',
      table: 'repair_service',
      label: 'repair_service',
    },
    {
      entityType: 'FBA_SHIPMENT',
      table: 'fba_shipments',
      label: 'fba_shipments',
    },
    {
      entityType: 'RECEIVING',
      table: 'receiving',
      label: 'receiving',
    },
  ];

  // Only check tables that actually exist
  const { rows: existingTables } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const tableSet = new Set(existingTables.map((r) => r.table_name));

  let anyIssue = false;
  for (const { entityType, table, label } of checks) {
    if (!tableSet.has(table)) {
      console.log(`  ⚠  Table '${table}' not found — skipping ${entityType} check.`);
      continue;
    }

    const { rows } = await client.query(
      `SELECT wa.id, wa.entity_id, wa.work_type, wa.status
       FROM work_assignments wa
       WHERE wa.entity_type = $1
         AND NOT EXISTS (
           SELECT 1 FROM ${table} t WHERE t.id = wa.entity_id
         )
       ORDER BY wa.id`,
      [entityType]
    );

    if (rows.length === 0) {
      ok(`No orphaned ${entityType} rows.`);
    } else {
      anyIssue = true;
      for (const r of rows) {
        issue(
          `id=${r.id}  ${entityType}/${r.work_type}  entity_id=${r.entity_id}  ` +
          `status=${r.status}  ← no matching ${label} record`
        );
      }

      if (FIX_MODE) {
        // Cancel active orphaned rows; completed/canceled ones are handled by check4
        const activeOrphans = rows.filter((r) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(r.status));
        if (activeOrphans.length > 0) {
          const ids = activeOrphans.map((r) => r.id);
          await client.query(
            `UPDATE work_assignments
             SET status = 'CANCELED'::assignment_status_enum,
                 completed_at = NOW(),
                 updated_at = NOW()
             WHERE id = ANY($1::int[])`,
            [ids]
          );
          fixed(`Canceled ${ids.length} active orphaned ${entityType} row(s): [${ids}]`);
        }
      }
    }
  }

  if (!anyIssue) ok('No orphaned rows detected.');
}

async function check7_invalidStaffIds() {
  header('CHECK 7 · Invalid staff IDs in assigned_tech_id / assigned_packer_id');
  const { rows } = await client.query(`
    SELECT wa.id, wa.entity_type, wa.entity_id, wa.work_type,
           wa.assigned_tech_id, wa.assigned_packer_id
    FROM work_assignments wa
    WHERE (
      wa.assigned_tech_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = wa.assigned_tech_id)
    ) OR (
      wa.assigned_packer_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = wa.assigned_packer_id)
    )
    ORDER BY wa.id
  `);

  if (rows.length === 0) { ok('All staff IDs reference valid staff records.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  ${r.entity_type}/${r.work_type}  entity_id=${r.entity_id}  ` +
      `tech_id=${r.assigned_tech_id}  packer_id=${r.assigned_packer_id}`
    );
  }
  console.log('  These IDs have no matching row in the staff table.');
}

async function check8_ghostDonePackRows() {
  header('CHECK 8 · Ghost DONE ORDER/PACK rows with NULL assigned_packer_id');
  const { rows } = await client.query(`
    SELECT id, entity_id, status, completed_at, created_at
    FROM work_assignments
    WHERE entity_type = 'ORDER'
      AND work_type   = 'PACK'
      AND status      = 'DONE'
      AND assigned_packer_id IS NULL
      AND assigned_tech_id   IS NULL
    ORDER BY id
  `);

  if (rows.length === 0) { ok('No ghost DONE PACK rows found.'); return; }

  for (const r of rows) {
    issue(
      `id=${r.id}  order_id=${r.entity_id}  status=${r.status}  ` +
      `created=${r.created_at?.toISOString().slice(0, 10) ?? 'unknown'}  ← no packer, no tech`
    );
  }

  if (FIX_MODE) {
    const ids = rows.map((r) => r.id);
    await client.query(
      `UPDATE work_assignments
       SET status = 'CANCELED'::assignment_status_enum,
           completed_at = COALESCE(completed_at, NOW()),
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    fixed(`Canceled ${ids.length} ghost DONE PACK row(s): [${ids}]`);
  }
}

async function printSummary() {
  header('SUMMARY');
  const { rows } = await client.query(`
    SELECT
      entity_type,
      work_type,
      status,
      COUNT(*) AS cnt,
      COUNT(assigned_tech_id) AS with_tech,
      COUNT(assigned_packer_id) AS with_packer
    FROM work_assignments
    GROUP BY entity_type, work_type, status
    ORDER BY entity_type, work_type, status
  `);

  console.log(
    `  ${'entity_type'.padEnd(16)}${'work_type'.padEnd(16)}${'status'.padEnd(14)}` +
    `${'rows'.padStart(6)}  ${'w/tech'.padStart(7)}  ${'w/packer'.padStart(9)}`
  );
  console.log('  ' + '─'.repeat(68));
  for (const r of rows) {
    console.log(
      `  ${r.entity_type.padEnd(16)}${r.work_type.padEnd(16)}${r.status.padEnd(14)}` +
      `${String(r.cnt).padStart(6)}  ${String(r.with_tech).padStart(7)}  ${String(r.with_packer).padStart(9)}`
    );
  }

  console.log('\n' + '─'.repeat(72));
  if (totalIssues === 0) {
    console.log('  All checks passed. work_assignments table looks clean.\n');
  } else {
    console.log(
      `  ${totalIssues} issue(s) found.` +
      (FIX_MODE ? '  Auto-fixes applied above.' : '  Re-run with --fix to auto-repair safe issues.') +
      '\n'
    );
  }
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  work_assignments integrity checker' + (FIX_MODE ? '  [FIX MODE]' : '  [READ-ONLY]'));
  console.log('══════════════════════════════════════════════════════════════════════');

  await client.connect();

  await check1_duplicateActiveRows();
  await check2_orderTestWithPacker();
  await check3_orderPackWithTech();
  await check4_doneWithoutCompletedAt();
  await check5_assignedWithNoStaff();
  await check6_orphanedRows();
  await check7_invalidStaffIds();
  await check8_ghostDonePackRows();
  await printSummary();

  await client.end();
}

main().catch((err) => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
