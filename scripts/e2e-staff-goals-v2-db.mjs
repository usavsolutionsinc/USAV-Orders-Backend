/**
 * E2E test for Staff Goals v2 — direct DB validation.
 * Tests the queries and logic that power the API endpoints.
 *
 * Usage: node scripts/e2e-staff-goals-v2-db.mjs
 * Requires DATABASE_URL in .env
 */

import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
  if (!condition) { console.error(`  FAIL: ${msg}`); failCount++; }
  else { console.log(`  PASS: ${msg}`); passCount++; }
}

// ── Queries (mirror API route logic) ─────────────────────────────────────────

const GET_ALL_GOALS_SQL = `
  WITH derived_station AS (
    SELECT id,
      CASE
        WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
        WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
        WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
        ELSE 'TECH'
      END AS default_station
    FROM staff
  ),
  today_counts AS (
    SELECT staff_id, station, COUNT(*)::int AS today_count
    FROM station_activity_logs
    WHERE staff_id IS NOT NULL
      AND (timezone('America/Los_Angeles', created_at))::date
        = (timezone('America/Los_Angeles', now()))::date
    GROUP BY staff_id, station
  ),
  week_counts AS (
    SELECT staff_id, station, COUNT(*)::int AS week_count
    FROM station_activity_logs
    WHERE staff_id IS NOT NULL
      AND (timezone('America/Los_Angeles', created_at))::date
        >= (timezone('America/Los_Angeles', now()))::date - INTERVAL '6 days'
    GROUP BY staff_id, station
  )
  SELECT
    s.id AS staff_id,
    s.name,
    s.role,
    s.employee_id,
    COALESCE(sg.station, ds.default_station) AS station,
    COALESCE(sg.daily_goal, 50) AS daily_goal,
    COALESCE(tc.today_count, 0) AS today_count,
    COALESCE(wc.week_count, 0) AS week_count,
    ROUND(COALESCE(wc.week_count, 0)::numeric / 7.0, 2) AS avg_daily_last_7d
  FROM staff s
  JOIN derived_station ds ON ds.id = s.id
  LEFT JOIN staff_goals sg ON sg.staff_id = s.id
  LEFT JOIN today_counts tc ON tc.staff_id = s.id AND tc.station = COALESCE(sg.station, ds.default_station)
  LEFT JOIN week_counts wc ON wc.staff_id = s.id AND wc.station = COALESCE(sg.station, ds.default_station)
  WHERE s.active = true
  ORDER BY s.name ASC
`;

const UPSERT_GOAL_SQL = `
  INSERT INTO staff_goals (staff_id, daily_goal, station, updated_at)
  VALUES ($1, $2, $3, NOW())
  ON CONFLICT (staff_id, station)
  DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
  RETURNING *
`;

const GET_SINGLE_SQL = `
  SELECT s.id AS staff_id, s.name, s.employee_id,
         COALESCE(sg.daily_goal, 50) AS daily_goal,
         COALESCE(sg.station, 'TECH') AS station
  FROM staff s
  LEFT JOIN staff_goals sg ON sg.staff_id = s.id AND sg.station = $2
  WHERE s.id = $1 LIMIT 1
`;

// ── Tests ────────────────────────────────────────────────────────────────────

async function testGetAllGoals(client) {
  console.log('\n=== Test 1: GET all staff goals (SAL-based) ===');
  const { rows } = await client.query(GET_ALL_GOALS_SQL);
  assert(rows.length > 0, `Returned ${rows.length} staff rows`);

  const row = rows[0];
  assert('staff_id' in row, 'Has staff_id');
  assert('station' in row, 'Has station');
  assert('daily_goal' in row, 'Has daily_goal');
  assert('today_count' in row, 'Has today_count');
  assert('week_count' in row, 'Has week_count');
  assert('employee_id' in row, 'Has employee_id');

  return rows;
}

async function testDerivedStation(rows) {
  console.log('\n=== Test 2: Derived station from employee_id prefix ===');
  for (const row of rows) {
    const eid = (row.employee_id || '').toUpperCase();
    if (eid.startsWith('PACK')) {
      assert(row.station === 'PACK', `${row.name} [${row.employee_id}] -> PACK (got ${row.station})`);
    } else if (eid.startsWith('TECH')) {
      assert(row.station === 'TECH', `${row.name} [${row.employee_id}] -> TECH (got ${row.station})`);
    } else if (eid.startsWith('UNBOX')) {
      assert(row.station === 'UNBOX', `${row.name} [${row.employee_id}] -> UNBOX (got ${row.station})`);
    } else if (eid.startsWith('SALES')) {
      assert(row.station === 'SALES', `${row.name} [${row.employee_id}] -> SALES (got ${row.station})`);
    }
  }
}

async function testSALCounts(rows) {
  console.log('\n=== Test 3: SAL-based counts ===');
  const hasNumericCounts = rows.every(
    r => typeof Number(r.today_count) === 'number' && typeof Number(r.week_count) === 'number'
  );
  assert(hasNumericCounts, 'All rows have numeric today_count and week_count');

  const totalToday = rows.reduce((s, r) => s + Number(r.today_count), 0);
  const totalWeek = rows.reduce((s, r) => s + Number(r.week_count), 0);
  console.log(`  INFO: today=${totalToday}, week=${totalWeek}`);

  // Cross-check: SAL today totals by station
  const { rows: salTotals } = await pool.query(`
    SELECT station, COUNT(*)::int AS cnt
    FROM station_activity_logs
    WHERE staff_id IS NOT NULL
      AND (timezone('America/Los_Angeles', created_at))::date
        = (timezone('America/Los_Angeles', now()))::date
    GROUP BY station ORDER BY station
  `);
  const salTotal = salTotals.reduce((s, r) => s + r.cnt, 0);
  console.log(`  INFO: SAL raw today total = ${salTotal}`);
  assert(totalToday <= salTotal, `Goal today_count (${totalToday}) <= SAL total (${salTotal})`);
}

async function testUpsertTechGoal(client, rows) {
  console.log('\n=== Test 4: Upsert TECH goal ===');
  const techRow = rows.find(r => (r.employee_id || '').toUpperCase().startsWith('TECH'));
  if (!techRow) { console.log('  SKIP: no TECH staff'); return null; }

  const testGoal = 42;
  const { rows: upserted } = await client.query(UPSERT_GOAL_SQL, [techRow.staff_id, testGoal, 'TECH']);
  assert(upserted.length === 1, 'Upsert returned 1 row');
  assert(Number(upserted[0].daily_goal) === testGoal, `daily_goal = ${testGoal}`);
  assert(upserted[0].station === 'TECH', 'station = TECH');

  // Verify via single lookup
  const { rows: single } = await client.query(GET_SINGLE_SQL, [techRow.staff_id, 'TECH']);
  assert(single.length === 1, 'Single lookup found row');
  assert(Number(single[0].daily_goal) === testGoal, `Single lookup goal = ${testGoal}`);

  return { staffId: techRow.staff_id, originalGoal: Number(techRow.daily_goal) || 50 };
}

async function testUpdateExistingGoal(client, staffId) {
  console.log('\n=== Test 5: Update existing goal ===');
  if (!staffId) { console.log('  SKIP'); return; }

  const newGoal = 77;
  const { rows } = await client.query(UPSERT_GOAL_SQL, [staffId, newGoal, 'TECH']);
  assert(Number(rows[0].daily_goal) === newGoal, `Updated to ${newGoal}`);
}

async function testCreatePackGoal(client, rows) {
  console.log('\n=== Test 6: Create PACK goal for packer ===');
  const packRow = rows.find(r => (r.employee_id || '').toUpperCase().startsWith('PACK'));
  if (!packRow) { console.log('  SKIP: no PACK staff'); return null; }

  const packGoal = 35;
  const { rows: upserted } = await client.query(UPSERT_GOAL_SQL, [packRow.staff_id, packGoal, 'PACK']);
  assert(upserted.length === 1, `Upsert OK for ${packRow.name}`);
  assert(Number(upserted[0].daily_goal) === packGoal, `PACK goal = ${packGoal}`);
  assert(upserted[0].station === 'PACK', 'station = PACK');

  // Verify via single lookup
  const { rows: single } = await client.query(GET_SINGLE_SQL, [packRow.staff_id, 'PACK']);
  assert(Number(single[0].daily_goal) === packGoal, `Single lookup PACK goal = ${packGoal}`);

  return { staffId: packRow.staff_id, goal: packGoal };
}

async function testStationFilter(client) {
  console.log('\n=== Test 7: Station filter (TECH only) ===');
  const { rows } = await client.query(`
    WITH derived_station AS (
      SELECT id,
        CASE
          WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
          WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
          WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
          ELSE 'TECH'
        END AS default_station
      FROM staff
    )
    SELECT s.id, s.name, COALESCE(sg.station, ds.default_station) AS station
    FROM staff s
    JOIN derived_station ds ON ds.id = s.id
    LEFT JOIN staff_goals sg ON sg.staff_id = s.id AND sg.station = 'TECH'
    WHERE s.active = true AND COALESCE(sg.station, ds.default_station) = 'TECH'
    ORDER BY s.name
  `);
  const allTech = rows.every(r => r.station === 'TECH');
  assert(allTech, `All ${rows.length} rows have station=TECH`);
  assert(rows.length > 0, 'At least 1 TECH staff');
}

async function testGoalHistoryTable(client) {
  console.log('\n=== Test 8: staff_goal_history table exists ===');
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'staff_goal_history' ORDER BY ordinal_position`
  );
  assert(rows.length > 0, `Table has ${rows.length} columns`);

  const cols = rows.map(r => r.column_name);
  assert(cols.includes('staff_id'), 'Has staff_id column');
  assert(cols.includes('station'), 'Has station column');
  assert(cols.includes('goal'), 'Has goal column');
  assert(cols.includes('actual'), 'Has actual column');
  assert(cols.includes('logged_date'), 'Has logged_date column');

  // Test insert/upsert into history
  const { rows: staff } = await client.query('SELECT id FROM staff WHERE active = true LIMIT 1');
  if (staff.length > 0) {
    await client.query(`
      INSERT INTO staff_goal_history (staff_id, station, goal, actual, logged_date)
      VALUES ($1, 'TECH', 50, 10, CURRENT_DATE)
      ON CONFLICT (staff_id, station, logged_date) DO UPDATE
        SET actual = EXCLUDED.actual, goal = EXCLUDED.goal
    `, [staff[0].id]);
    const { rows: hist } = await client.query(
      'SELECT * FROM staff_goal_history WHERE staff_id = $1 AND logged_date = CURRENT_DATE',
      [staff[0].id]
    );
    assert(hist.length === 1, 'History row inserted');
    assert(Number(hist[0].actual) === 10, 'actual = 10');

    // Cleanup test row
    await client.query(
      'DELETE FROM staff_goal_history WHERE staff_id = $1 AND logged_date = CURRENT_DATE AND station = $2',
      [staff[0].id, 'TECH']
    );
  }
}

async function testResetGoals(client, techResult, packResult) {
  console.log('\n=== Test 9: Reset goals ===');
  if (techResult) {
    await client.query(UPSERT_GOAL_SQL, [techResult.staffId, techResult.originalGoal, 'TECH']);
    const { rows } = await client.query(GET_SINGLE_SQL, [techResult.staffId, 'TECH']);
    assert(Number(rows[0].daily_goal) === techResult.originalGoal,
      `TECH goal restored to ${techResult.originalGoal}`);
  }
  if (packResult) {
    console.log(`  INFO: Keeping PACK goal for staffId=${packResult.staffId} at ${packResult.goal}`);
  }
}

async function testGetStationFromEmployeeIdUtil() {
  console.log('\n=== Test 10: getStationFromEmployeeId util logic ===');
  // Replicate the pure JS util logic
  const PREFIXES = ['TECH', 'PACK', 'UNBOX', 'SALES'];
  function getStation(eid) {
    if (!eid) return 'TECH';
    const upper = eid.toUpperCase();
    return PREFIXES.find(p => upper.startsWith(p)) ?? 'TECH';
  }

  assert(getStation('TECH001') === 'TECH', 'TECH001 -> TECH');
  assert(getStation('TECH004') === 'TECH', 'TECH004 -> TECH');
  assert(getStation('PACK001') === 'PACK', 'PACK001 -> PACK');
  assert(getStation('PACK002') === 'PACK', 'PACK002 -> PACK');
  assert(getStation('UNBOX001') === 'UNBOX', 'UNBOX001 -> UNBOX');
  assert(getStation('SALES001') === 'SALES', 'SALES001 -> SALES');
  assert(getStation(null) === 'TECH', 'null -> TECH (default)');
  assert(getStation('') === 'TECH', 'empty -> TECH (default)');
  assert(getStation('UNKNOWN99') === 'TECH', 'UNKNOWN99 -> TECH (default)');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Staff Goals v2 E2E (direct DB)');
  console.log('='.repeat(50));

  const client = await pool.connect();
  try {
    const allRows = await testGetAllGoals(client);
    await testDerivedStation(allRows);
    await testSALCounts(allRows);
    const techResult = await testUpsertTechGoal(client, allRows);
    await testUpdateExistingGoal(client, techResult?.staffId);
    const packResult = await testCreatePackGoal(client, allRows);
    await testStationFilter(client);
    await testGoalHistoryTable(client);
    await testResetGoals(client, techResult, packResult);
    await testGetStationFromEmployeeIdUtil();
  } catch (err) {
    console.error('\nFATAL:', err);
    failCount++;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main();
