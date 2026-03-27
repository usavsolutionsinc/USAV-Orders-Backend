/**
 * E2E test for SAL-SoT (Phase 1 compatible).
 * Tests: tracking scan, optional FNSKU scan, serial add/update/undo, delete, logs query.
 *
 * Usage:
 *   node scripts/e2e-sal-sot.mjs [BASE_URL] [TECH_ID] [FNSKU]
 *
 * Env overrides:
 *   SAL_SOT_BASE_URL, SAL_SOT_TECH_ID, SAL_SOT_FNSKU
 */

const BASE = process.argv[2] || process.env.SAL_SOT_BASE_URL || 'http://localhost:3000';
const TECH_ID = Number(process.argv[3] || process.env.SAL_SOT_TECH_ID || 1);
const FNSKU = String(process.argv[4] || process.env.SAL_SOT_FNSKU || 'X00TEST000').trim().toUpperCase();
const TRACKING = `TEST-E2E-TRACKING-${Date.now()}`;

const allowedSourceKinds = new Set(['tech_scan', 'tech_serial', 'fba_scan']);

async function api(path, body) {
  const url = `${BASE}${path}`;
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };

  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, ok: res.ok, data, url };
  } catch (error) {
    const err = error && typeof error === 'object' ? error : new Error(String(error));
    throw new Error(`Request failed: ${url} (${err.message || 'unknown error'})`);
  }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS: ${msg}`);
  }
}

function assertHttpOk(result, label) {
  assert(result.ok === true, `${label} HTTP ${result.status}`);
  if (!result.ok) {
    console.log(`  INFO: ${label} response body:`, result.data);
  }
}

async function testTrackingScan() {
  console.log('\n=== Test: Tracking Scan ===');
  const result = await api('/api/tech/scan', {
    type: 'TRACKING',
    value: TRACKING,
    techId: TECH_ID,
  });
  assertHttpOk(result, 'tracking scan');
  const { data } = result;
  assert(data?.success === true, 'scan returns success');
  assert(data?.found === true, 'scan returns found');
  assert(typeof data?.salId === 'number', `salId returned: ${data?.salId}`);
  assert(typeof data?.scanSessionId === 'string' && data.scanSessionId.length > 0, 'scanSessionId returned');
  return data;
}

async function testFnskuScan() {
  console.log('\n=== Test: FNSKU Scan ===');
  const result = await api('/api/tech/scan', {
    type: 'FNSKU',
    value: FNSKU,
    techId: TECH_ID,
  });
  if (result.status === 404) {
    console.log(`  SKIP: ${FNSKU} not found in fba_fnskus catalog`);
    return null;
  }
  assertHttpOk(result, 'fnsku scan');
  const { data } = result;
  assert(data?.success === true, 'FNSKU scan returns success');
  assert(typeof data?.salId === 'number', `salId returned: ${data?.salId}`);
  assert(typeof data?.fnskuLogId === 'number', `fnskuLogId returned: ${data?.fnskuLogId}`);
  return data;
}

async function testSerialAdd(salId) {
  console.log('\n=== Test: Serial Add ===');
  const serial = `E2E-SERIAL-${Date.now()}`;
  const result = await api('/api/tech/serial', {
    action: 'add',
    salId,
    serial,
    techId: TECH_ID,
  });
  assertHttpOk(result, 'serial add');
  const { data } = result;
  assert(data?.success === true, 'serial add returns success');
  assert(Array.isArray(data?.serialNumbers), 'serialNumbers is array');
  assert(data?.serialNumbers?.includes(serial), `serial ${serial} in list`);
  return { serial, tsnId: data?.tsnId };
}

async function testSerialUpdate(salId) {
  console.log('\n=== Test: Serial Update (batch) ===');
  const s1 = `E2E-BATCH-A-${Date.now()}`;
  const s2 = `E2E-BATCH-B-${Date.now()}`;
  const result = await api('/api/tech/serial', {
    action: 'update',
    salId,
    serials: [s1, s2],
    techId: TECH_ID,
  });
  assertHttpOk(result, 'serial update');
  const { data } = result;
  assert(data?.success === true, 'update returns success');
  assert(data?.serialNumbers?.length === 2, `2 serials after update: ${data?.serialNumbers?.length}`);
  return data;
}

async function testSerialUndo(salId) {
  console.log('\n=== Test: Serial Undo ===');
  const result = await api('/api/tech/serial', {
    action: 'undo',
    salId,
    techId: TECH_ID,
  });
  assertHttpOk(result, 'serial undo');
  const { data } = result;
  assert(data?.success === true, 'undo returns success');
  assert(data?.serialNumbers?.length === 1, `1 serial after undo: ${data?.serialNumbers?.length}`);
  assert(typeof data?.removedSerial === 'string', `removed serial: ${data?.removedSerial}`);
  return data;
}

async function testDelete(salId) {
  console.log('\n=== Test: Delete ===');
  const result = await api('/api/tech/delete', { salId });
  assertHttpOk(result, 'delete');
  const { data } = result;
  assert(data?.success === true, 'delete returns success');
  const deletedCount = typeof data?.deletedSerials === 'number'
    ? data.deletedSerials
    : (typeof data?.deletedCount === 'number' ? data.deletedCount : null);
  assert(typeof deletedCount === 'number', `deleted serials/count: ${deletedCount}`);
  return data;
}

async function testLogs() {
  console.log('\n=== Test: Tech Logs Query ===');
  const result = await api(`/api/tech/logs?techId=${TECH_ID}&limit=5`);
  assertHttpOk(result, 'tech logs');
  const { data } = result;
  assert(Array.isArray(data), 'logs returns array');
  if (Array.isArray(data) && data.length > 0) {
    const row = data[0];
    assert(typeof row.id === 'number', `row.id is number: ${row.id}`);
    assert(allowedSourceKinds.has(row.source_kind), `source_kind valid: ${row.source_kind}`);
    assert(
      typeof row.shipping_tracking_number === 'string' || row.shipping_tracking_number === null,
      'has shipping_tracking_number'
    );
    console.log(`  INFO: ${data.length} rows returned`);
  } else {
    console.log('  INFO: 0 rows (empty table)');
  }
  return data;
}

async function main() {
  if (!Number.isFinite(TECH_ID) || TECH_ID <= 0) {
    throw new Error(`Invalid TECH_ID: ${TECH_ID}`);
  }

  console.log(`E2E SAL-SoT tests against ${BASE}`);
  console.log(`Using techId=${TECH_ID}, tracking=${TRACKING}, fnsku=${FNSKU}`);

  // 1. Tracking scan
  const trackingScan = await testTrackingScan();

  // 2. FNSKU scan (optional pass if catalog row exists)
  await testFnskuScan();

  // 3. Serial operations (on the tracking scan SAL anchor)
  if (trackingScan?.salId) {
    await testSerialAdd(trackingScan.salId);
    await testSerialUpdate(trackingScan.salId);
    await testSerialUndo(trackingScan.salId);
    await testDelete(trackingScan.salId);
  }

  // 4. Logs query
  await testLogs();

  console.log('\n=== Done ===');
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests PASSED');
  }
}

main().catch((err) => {
  console.error('E2E test crashed:', err?.message || err);
  process.exitCode = 1;
});
