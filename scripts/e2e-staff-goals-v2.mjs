/**
 * E2E test for Staff Goals v2 (station-aware, SAL-based counting).
 *
 * Tests:
 *   1. GET /api/staff-goals — returns all active staff with station derived from employee_id
 *   2. GET /api/staff-goals?staffId=X — single staff lookup with station
 *   3. GET /api/staff-goals?station=TECH — station filter
 *   4. PUT /api/staff-goals — upsert goal with station
 *   5. PUT /api/staff-goals — update existing goal
 *   6. PUT /api/staff-goals — create PACK goal for packer
 *   7. Verify SAL-based counts (today_count, week_count) are present
 *   8. Verify derived_station logic (PACK employee → PACK station)
 *   9. PUT validation (bad inputs)
 *  10. Reset goals to original values
 *
 * Usage:
 *   node scripts/e2e-staff-goals-v2.mjs [BASE_URL]
 */

const BASE = process.argv[2] || process.env.GOALS_BASE_URL || 'http://localhost:3000';

let passCount = 0;
let failCount = 0;

async function api(path, body, method) {
  const url = `${BASE}${path}`;
  const opts = body
    ? { method: method || 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: method || 'GET' };

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { status: res.status, ok: res.ok, data, url };
  } catch (error) {
    throw new Error(`Request failed: ${url} (${error?.message || 'unknown'})`);
  }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failCount++;
  } else {
    console.log(`  PASS: ${msg}`);
    passCount++;
  }
}

// ── Test 1: GET all staff goals ──────────────────────────────────────────────

async function testGetAllGoals() {
  console.log('\n=== Test 1: GET /api/staff-goals (all staff) ===');
  const result = await api('/api/staff-goals');
  assert(result.ok, `HTTP ${result.status} OK`);
  assert(Array.isArray(result.data), 'Response is an array');
  assert(result.data.length > 0, `Returned ${result.data.length} staff rows`);

  // Every row should have the expected fields
  const row = result.data[0];
  assert('staff_id' in row, 'Has staff_id');
  assert('name' in row, 'Has name');
  assert('station' in row, 'Has station field');
  assert('daily_goal' in row, 'Has daily_goal');
  assert('today_count' in row, 'Has today_count');
  assert('week_count' in row, 'Has week_count');
  assert('employee_id' in row, 'Has employee_id');

  return result.data;
}

// ── Test 2: GET single staff goal ────────────────────────────────────────────

async function testGetSingleGoal(allRows) {
  console.log('\n=== Test 2: GET /api/staff-goals?staffId=X (single) ===');
  const techRow = allRows.find(r => r.employee_id && r.employee_id.startsWith('TECH'));
  assert(techRow, `Found a TECH employee: ${techRow?.name} [${techRow?.employee_id}]`);
  if (!techRow) return;

  const result = await api(`/api/staff-goals?staffId=${techRow.staff_id}`);
  assert(result.ok, `HTTP ${result.status} OK`);
  assert(result.data.staff_id === techRow.staff_id, `staff_id matches: ${result.data.staff_id}`);
  assert(result.data.daily_goal > 0, `daily_goal > 0: ${result.data.daily_goal}`);
}

// ── Test 3: GET with station filter ──────────────────────────────────────────

async function testStationFilter() {
  console.log('\n=== Test 3: GET /api/staff-goals?station=TECH (filter) ===');
  const result = await api('/api/staff-goals?station=TECH');
  assert(result.ok, `HTTP ${result.status} OK`);
  assert(Array.isArray(result.data), 'Response is an array');

  const allTech = result.data.every(r => r.station === 'TECH');
  assert(allTech, `All rows have station=TECH (${result.data.length} rows)`);

  console.log('\n=== Test 3b: GET /api/staff-goals?station=PACK (filter) ===');
  const packResult = await api('/api/staff-goals?station=PACK');
  assert(packResult.ok, `HTTP ${packResult.status} OK`);
  // Packers may not have explicit goal rows yet, but no errors
}

// ── Test 4: PUT upsert a TECH goal ──────────────────────────────────────────

async function testUpsertTechGoal(allRows) {
  console.log('\n=== Test 4: PUT /api/staff-goals (upsert TECH goal) ===');
  const techRow = allRows.find(r => r.employee_id && r.employee_id.startsWith('TECH'));
  if (!techRow) { console.log('  SKIP: no TECH staff found'); return null; }

  const testGoal = 42;
  const result = await api('/api/staff-goals', {
    staffId: techRow.staff_id,
    dailyGoal: testGoal,
    station: 'TECH',
  });
  assert(result.ok, `HTTP ${result.status} OK`);
  assert(result.data?.success === true, 'Response has success: true');

  // Verify it persisted
  const verify = await api(`/api/staff-goals?staffId=${techRow.staff_id}&station=TECH`);
  assert(verify.ok, `Verify GET OK`);
  assert(Number(verify.data?.daily_goal) === testGoal, `Goal persisted as ${testGoal}: got ${verify.data?.daily_goal}`);

  return { staffId: techRow.staff_id, originalGoal: techRow.daily_goal };
}

// ── Test 5: PUT update existing goal ─────────────────────────────────────────

async function testUpdateGoal(staffId) {
  console.log('\n=== Test 5: PUT /api/staff-goals (update existing) ===');
  if (!staffId) { console.log('  SKIP: no staffId from test 4'); return; }

  const newGoal = 77;
  const result = await api('/api/staff-goals', {
    staffId,
    dailyGoal: newGoal,
    station: 'TECH',
  });
  assert(result.ok, `HTTP ${result.status} OK`);

  const verify = await api(`/api/staff-goals?staffId=${staffId}&station=TECH`);
  assert(Number(verify.data?.daily_goal) === newGoal, `Goal updated to ${newGoal}: got ${verify.data?.daily_goal}`);
}

// ── Test 6: PUT create PACK goal for packer ──────────────────────────────────

async function testCreatePackGoal(allRows) {
  console.log('\n=== Test 6: PUT /api/staff-goals (create PACK goal) ===');
  const packRow = allRows.find(r => r.employee_id && r.employee_id.startsWith('PACK'));
  if (!packRow) { console.log('  SKIP: no PACK staff found'); return null; }

  const packGoal = 35;
  const result = await api('/api/staff-goals', {
    staffId: packRow.staff_id,
    dailyGoal: packGoal,
    station: 'PACK',
  });
  assert(result.ok, `HTTP ${result.status} OK for ${packRow.name}`);

  const verify = await api(`/api/staff-goals?staffId=${packRow.staff_id}&station=PACK`);
  assert(verify.ok, `Verify GET OK`);
  assert(Number(verify.data?.daily_goal) === packGoal, `PACK goal = ${packGoal}: got ${verify.data?.daily_goal}`);

  return { staffId: packRow.staff_id, goal: packGoal };
}

// ── Test 7: Verify SAL-based counts are present ─────────────────────────────

async function testSALCounts(allRows) {
  console.log('\n=== Test 7: SAL-based counts present ===');

  const hasCountFields = allRows.every(r =>
    typeof r.today_count === 'number' && typeof r.week_count === 'number'
  );
  assert(hasCountFields, 'All rows have numeric today_count and week_count');

  const totalToday = allRows.reduce((sum, r) => sum + r.today_count, 0);
  const totalWeek = allRows.reduce((sum, r) => sum + r.week_count, 0);
  console.log(`  INFO: Total scans today=${totalToday}, week=${totalWeek}`);
  assert(totalWeek >= 0, 'week_count is non-negative');
}

// ── Test 8: Derived station logic ────────────────────────────────────────────

async function testDerivedStation(allRows) {
  console.log('\n=== Test 8: Derived station from employee_id ===');

  for (const row of allRows) {
    const eid = (row.employee_id || '').toUpperCase();
    if (eid.startsWith('PACK')) {
      assert(row.station === 'PACK', `${row.name} [${row.employee_id}] → station=PACK`);
    } else if (eid.startsWith('TECH')) {
      assert(row.station === 'TECH', `${row.name} [${row.employee_id}] → station=TECH`);
    } else if (eid.startsWith('UNBOX')) {
      assert(row.station === 'UNBOX', `${row.name} [${row.employee_id}] → station=UNBOX`);
    } else if (eid.startsWith('SALES')) {
      assert(row.station === 'SALES', `${row.name} [${row.employee_id}] → station=SALES`);
    }
  }
}

// ── Test 9: PUT validation ───────────────────────────────────────────────────

async function testValidation() {
  console.log('\n=== Test 9: PUT validation (bad inputs) ===');

  const r1 = await api('/api/staff-goals', { staffId: -1, dailyGoal: 50, station: 'TECH' });
  assert(!r1.ok, `Rejects negative staffId: HTTP ${r1.status}`);

  const r2 = await api('/api/staff-goals', { staffId: 1, dailyGoal: 0, station: 'TECH' });
  assert(!r2.ok, `Rejects dailyGoal=0: HTTP ${r2.status}`);

  const r3 = await api('/api/staff-goals', { staffId: 1, dailyGoal: 50, station: 'INVALID' });
  assert(!r3.ok, `Rejects invalid station: HTTP ${r3.status}`);
}

// ── Test 10: Reset goals ─────────────────────────────────────────────────────

async function testResetGoals(techResult, packResult) {
  console.log('\n=== Test 10: Reset goals to defaults ===');

  if (techResult) {
    const restore = techResult.originalGoal || 50;
    const r = await api('/api/staff-goals', {
      staffId: techResult.staffId,
      dailyGoal: restore,
      station: 'TECH',
    });
    assert(r.ok, `Restored TECH goal for staffId=${techResult.staffId} to ${restore}`);
  }

  // Leave PACK goal in place (it's a new feature, keep it)
  if (packResult) {
    console.log(`  INFO: Keeping PACK goal for staffId=${packResult.staffId} at ${packResult.goal}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Staff Goals v2 E2E — ${BASE}`);
  console.log('='.repeat(50));

  try {
    const allRows = await testGetAllGoals();
    await testGetSingleGoal(allRows);
    await testStationFilter();
    const techResult = await testUpsertTechGoal(allRows);
    await testUpdateGoal(techResult?.staffId ?? null);
    const packResult = await testCreatePackGoal(allRows);
    await testSALCounts(allRows);
    await testDerivedStation(allRows);
    await testValidation();
    await testResetGoals(techResult, packResult);
  } catch (err) {
    console.error('\nFATAL:', err);
    failCount++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main();
