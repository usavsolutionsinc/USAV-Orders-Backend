/**
 * E2E: SAL · TSN · FBA-FNSKU  —  DB-ping tests
 *
 * Verifies that each tech-station action correctly writes to the three tables
 * and that /api/tech/logs reads them back with the right shapes:
 *
 *   station_activity_logs  (SAL — source of truth for every scan)
 *   tech_serial_numbers    (TSN — one row per serial)
 *   fba_fnsku_logs         (FNSKU scan lifecycle row, FK → SAL)
 *
 * All assertions are derived from the actual route source.  No mocks.
 *
 * Usage:
 *   node scripts/e2e-sal-tsn-fba.mjs [BASE_URL]
 *   E2E_TECH_ID=3 node scripts/e2e-sal-tsn-fba.mjs https://your-app.vercel.app
 *
 *   BASE_URL default: http://localhost:3000
 *   E2E_TECH_ID: staff.id of an active tech (default: 1)
 *
 * Requires: backend running with a connected Neon DB.
 */

const BASE    = process.argv[2] ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const TECH_ID = Number(process.env.E2E_TECH_ID ?? '1');

// Unique per-run tag — prevents cross-run interference in shared DB
const TAG           = Date.now().toString(36).toUpperCase();
const TEST_TRACKING = `E2E-SAL-${TAG}`;
const TEST_FNSKU    = `E2EFNA${TAG}`.slice(0, 12);   // stays within a reasonable fnsku length; auto-created
const TEST_SERIAL_1 = `E2E-SN-${TAG}`;

let PASS = 0;
let FAIL = 0;

// ── utils ─────────────────────────────────────────────────────────────────────

function pass(label) {
  console.log(`  PASS  ${label}`);
  PASS++;
}

function fail(label, hint = '') {
  console.error(`  FAIL  ${label}${hint ? `  →  ${hint}` : ''}`);
  FAIL++;
  process.exitCode = 1;
}

function assert(cond, label, hint = '') {
  cond ? pass(label) : fail(label, hint);
}

async function api(path, body) {
  const url  = `${BASE}${path}`;
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const res  = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// ── phase 1: tracking scan creates SAL ───────────────────────────────────────

async function testTrackingScan() {
  console.log(`\n── 1  Tracking scan → SAL insert`);
  console.log(`     tracking: ${TEST_TRACKING}  techId: ${TECH_ID}`);

  // /api/tech/scan-tracking is a thin wrapper around POST /api/tech/scan { type:'TRACKING' }
  const { ok, status, data } = await api('/api/tech/scan-tracking', {
    tracking: TEST_TRACKING,
    techId:   TECH_ID,
  });

  assert(ok,                                    `HTTP ${status}`,                         JSON.stringify(data?.error ?? data));
  assert(data?.success === true,                `response.success === true`);
  assert(data?.found   === true,                `response.found === true  (exception path ok)`);
  assert(typeof data?.salId === 'number',       `salId is number`,                        String(data?.salId));
  assert(typeof data?.techActivityId === 'number', `techActivityId is number`,            String(data?.techActivityId));
  assert(data?.salId === data?.techActivityId,  `salId === techActivityId`);
  assert(data?.scanSessionId != null,           `scanSessionId present`);

  const salId = typeof data?.salId === 'number' ? data.salId : null;
  console.log(`     SAL id: ${salId}`);
  return salId;
}

// ── phase 2: tech-logs shows the SAL row ─────────────────────────────────────

async function testLogsShowSAL(salId) {
  console.log(`\n── 2  tech-logs shows SAL row  (id=${salId})`);

  const { ok, status, data } = await api(`/api/tech-logs?techId=${TECH_ID}&limit=30`);

  assert(ok,                  `HTTP ${status}`);
  assert(Array.isArray(data), `response is array`);
  if (!Array.isArray(data)) return;

  // tech/logs query: sal.id AS id, sal.id AS source_row_id
  const row = data.find(r => Number(r.id) === salId);
  assert(row != null, `SAL row id=${salId} in tech-logs  (${data.length} rows)`,
    data.length > 0 ? `first row id=${data[0]?.id}` : 'empty');

  if (!row) return;

  // Verify required fields from the SELECT in /api/tech/logs/route.ts
  const REQUIRED = ['id', 'source_row_id', 'source_kind', 'created_at', 'tested_by',
                    'shipping_tracking_number', 'serial_number', 'fnsku_log_id'];
  for (const f of REQUIRED) {
    assert(f in row, `field "${f}" present`, `keys: ${Object.keys(row).join(', ')}`);
  }

  const VALID_KINDS = new Set(['tech_scan', 'tech_serial', 'fba_scan']);
  assert(VALID_KINDS.has(row.source_kind), `source_kind "${row.source_kind}" is valid`);

  // Fresh tracking-only scan: no TSN rows yet → source_kind must be 'tech_scan'
  assert(row.source_kind === 'tech_scan',
    `source_kind === "tech_scan" (no serials yet)`, `got: "${row.source_kind}"`);

  console.log(`     source_kind="${row.source_kind}"  tracking="${row.shipping_tracking_number}"  serial="${row.serial_number}"`);
}

// ── phase 3: serial add creates TSN row ──────────────────────────────────────

async function testSerialAdd(salId) {
  console.log(`\n── 3  Serial add → TSN insert  (${TEST_SERIAL_1})`);

  // POST /api/tech/serial { action:'add', salId, serial, techId }
  // Route: inserts tech_serial_numbers row + SERIAL_ADDED SAL row
  // Response: { success, serialNumbers, tsnId }
  const { ok, status, data } = await api('/api/tech/serial', {
    action: 'add',
    salId,
    serial:  TEST_SERIAL_1,
    techId:  TECH_ID,
  });

  assert(ok,                              `HTTP ${status}`,                         JSON.stringify(data?.error));
  assert(data?.success === true,          `success === true`);
  assert(Array.isArray(data?.serialNumbers), `serialNumbers is array`);

  const stored = TEST_SERIAL_1.toUpperCase();   // route normalises via UPPER(TRIM())
  assert(
    Array.isArray(data?.serialNumbers) && data.serialNumbers.includes(stored),
    `"${stored}" in serialNumbers`,            JSON.stringify(data?.serialNumbers),
  );
  assert(typeof data?.tsnId === 'number', `tsnId is number`, String(data?.tsnId));

  console.log(`     TSN id: ${data?.tsnId}`);
  return data?.tsnId ?? null;
}

// ── phase 4: tech-logs aggregates serial + source_kind flips ─────────────────

async function testLogsShowSerial(salId) {
  console.log(`\n── 4  tech-logs: serial aggregated, source_kind → "tech_serial"`);

  const { ok, status, data } = await api(`/api/tech-logs?techId=${TECH_ID}&limit=30`);

  assert(ok,                  `HTTP ${status}`);
  assert(Array.isArray(data), `response is array`);
  if (!Array.isArray(data)) return;

  const row = data.find(r => Number(r.id) === salId);
  assert(row != null, `SAL row id=${salId} still in tech-logs`);
  if (!row) return;

  // After adding a serial: source_kind computed as 'tech_serial' because
  // EXISTS (SELECT 1 FROM tech_serial_numbers WHERE context_station_activity_log_id = sal.id)
  assert(row.source_kind === 'tech_serial',
    `source_kind flipped to "tech_serial"`,    `got: "${row.source_kind}"`);

  // serial_number: STRING_AGG from TSN rows → should include TEST_SERIAL_1 (uppercased)
  const stored = TEST_SERIAL_1.toUpperCase();
  assert(
    typeof row.serial_number === 'string' && row.serial_number.toUpperCase().includes(stored),
    `serial_number contains "${stored}"`,       `got: "${row.serial_number}"`,
  );

  console.log(`     source_kind="${row.source_kind}"  serial_number="${row.serial_number}"`);
}

// ── phase 5: serial undo removes TSN row ─────────────────────────────────────

async function testSerialUndo(salId) {
  console.log(`\n── 5  Serial undo → TSN deleted`);

  // POST /api/tech/serial { action:'undo', salId, techId }
  // Route: deletes last TSN row for the SAL; returns removedSerial
  const { ok, status, data } = await api('/api/tech/serial', {
    action: 'undo',
    salId,
    techId: TECH_ID,
  });

  assert(ok,                         `HTTP ${status}`,           JSON.stringify(data?.error));
  assert(data?.success === true,     `success === true`);
  assert(Array.isArray(data?.serialNumbers), `serialNumbers is array`);
  assert(data?.serialNumbers?.length === 0,
    `serialNumbers empty after undo`,           `count: ${data?.serialNumbers?.length}`);

  const stored = TEST_SERIAL_1.toUpperCase();
  assert(
    typeof data?.removedSerial === 'string' &&
    data.removedSerial.toUpperCase() === stored,
    `removedSerial === "${stored}"`,            `got: "${data?.removedSerial}"`,
  );
}

// ── phase 6: source_kind reverts after undo ───────────────────────────────────

async function testLogsSourceKindReverts(salId) {
  console.log(`\n── 6  tech-logs: source_kind reverts to "tech_scan" after undo`);

  const { ok, status, data } = await api(`/api/tech-logs?techId=${TECH_ID}&limit=30`);

  assert(ok,                  `HTTP ${status}`);
  assert(Array.isArray(data), `response is array`);
  if (!Array.isArray(data)) return;

  const row = data.find(r => Number(r.id) === salId);
  assert(row != null, `SAL row id=${salId} still in tech-logs after undo`);
  if (!row) return;

  // No TSN rows → source_kind reverts to 'tech_scan'
  assert(row.source_kind === 'tech_scan',
    `source_kind reverted to "tech_scan"`,      `got: "${row.source_kind}"`);
  assert(
    row.serial_number == null || row.serial_number === '',
    `serial_number is null/empty after undo`,   `got: "${row.serial_number}"`,
  );

  console.log(`     source_kind="${row.source_kind}"  serial_number="${row.serial_number}"`);
}

// ── phase 7: FNSKU scan creates SAL + fba_fnsku_logs ─────────────────────────

async function testFnskuScan() {
  console.log(`\n── 7  FNSKU scan → SAL + fba_fnsku_logs  (fnsku=${TEST_FNSKU})`);

  // POST /api/tech/scan { type:'FNSKU', value, techId }
  // Uses ensureFnskuCatalog → auto-creates stub in fba_fnskus if missing
  // Then createFbaLog with stationActivityLogId → fba_fnsku_logs.station_activity_log_id is set
  // Response: { success, found, orderFound, catalogCreated, salId, fnskuLogId,
  //             techActivityId (===salId), scanSessionId, summary, shipment, order }
  const { ok, status, data } = await api('/api/tech/scan', {
    type:   'FNSKU',
    value:  TEST_FNSKU,
    techId: TECH_ID,
  });

  assert(ok,                                   `HTTP ${status}`,                      JSON.stringify(data?.error ?? data));
  assert(data?.success === true,               `success === true`);
  assert(data?.found   === true,               `found === true`);
  assert(data?.orderFound === false,           `orderFound === false (FBA path)`);
  assert(typeof data?.salId === 'number',      `salId is number`,                     String(data?.salId));
  assert(typeof data?.fnskuLogId === 'number', `fnskuLogId is number`,                String(data?.fnskuLogId));
  assert(data?.techActivityId === data?.salId, `techActivityId === salId`);
  assert(data?.scanSessionId != null,          `scanSessionId present`);

  // catalogCreated: bool — true on first run, false on re-run with same fnsku
  assert(
    typeof data?.catalogCreated === 'boolean',
    `catalogCreated is boolean: ${data?.catalogCreated}`,
  );

  // summary shape from fnskuStageCounts
  const s = data?.summary;
  assert(
    s && typeof s.tech_scanned_qty === 'number' &&
         typeof s.pack_ready_qty   === 'number' &&
         typeof s.shipped_qty      === 'number' &&
         typeof s.available_to_ship === 'number',
    `summary has all stage-count fields`,       JSON.stringify(s),
  );
  assert(s?.tech_scanned_qty >= 1, `tech_scanned_qty >= 1 after scan`, String(s?.tech_scanned_qty));

  // order shape
  assert(data?.order?.orderId === 'FNSKU',     `order.orderId === "FNSKU"`);

  const fnskuSalId  = data?.salId    ?? null;
  const fnskuLogId  = data?.fnskuLogId ?? null;
  console.log(`     SAL id: ${fnskuSalId}   fnskuLogId: ${fnskuLogId}   catalogCreated: ${data?.catalogCreated}`);
  return { fnskuSalId, fnskuLogId };
}

// ── phase 8: tech-logs shows fba_scan row with fnsku_log_id populated ────────

async function testLogsShowFnskuRow(fnskuSalId, fnskuLogId) {
  console.log(`\n── 8  tech-logs: fba_scan row with fnsku_log_id  (salId=${fnskuSalId})`);

  const { ok, status, data } = await api(`/api/tech-logs?techId=${TECH_ID}&limit=30`);

  assert(ok,                  `HTTP ${status}`);
  assert(Array.isArray(data), `response is array`);
  if (!Array.isArray(data)) return;

  const row = data.find(r => Number(r.id) === fnskuSalId);
  assert(row != null, `fba_scan SAL row id=${fnskuSalId} in tech-logs  (${data.length} rows)`);
  if (!row) return;

  // FNSKU scan → source_kind = 'fba_scan'
  assert(row.source_kind === 'fba_scan',
    `source_kind === "fba_scan"`,               `got: "${row.source_kind}"`);

  // fnsku_log_id comes from LEFT JOIN fba_fnsku_logs ON station_activity_log_id = sal.id
  assert(Number(row.fnsku_log_id) === fnskuLogId,
    `fnsku_log_id === ${fnskuLogId}`,           `got: ${row.fnsku_log_id}`);

  // fnsku field comes from sal.fnsku
  assert(row.fnsku === TEST_FNSKU,
    `fnsku field === "${TEST_FNSKU}"`,          `got: "${row.fnsku}"`);

  // shipping_tracking_number = COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku)
  // For FNSKU scan: no stn/scan_ref → falls back to sal.fnsku
  assert(
    row.shipping_tracking_number === TEST_FNSKU,
    `shipping_tracking_number === "${TEST_FNSKU}"  (fallback to fnsku)`,
    `got: "${row.shipping_tracking_number}"`,
  );

  console.log(`     source_kind="${row.source_kind}"  fnsku="${row.fnsku}"  fnsku_log_id=${row.fnsku_log_id}`);
}

// ── phase 9: delete FNSKU scan (SAL + fba_fnsku_logs + any TSN) ──────────────

async function testDeleteFnskuScan(fnskuSalId) {
  console.log(`\n── 9  Delete FNSKU scan  (sourceKind=fba_scan  sourceRowId=${fnskuSalId})`);

  // delete-tracking with sourceKind='fba_scan' deletes:
  //   fba_fnsku_logs row (resolved via sal.metadata.fnsku_log_id or time-correlation)
  //   any TSN rows attached to that fnsku log
  //   the FNSKU SAL row itself
  // Response: { success: true, deletedCount: number }
  const { ok, status, data } = await api('/api/tech/delete-tracking', {
    sourceKind:   'fba_scan',
    sourceRowId:  fnskuSalId,
    techId:       TECH_ID,
  });

  assert(ok,                                     `HTTP ${status}`,                    JSON.stringify(data?.error));
  assert(data?.success === true,                 `success === true`);
  // tech/delete returns { success, deletedSerials: TSN count } — SAL + fba_fnsku_logs also removed
  assert(typeof data?.deletedSerials === 'number', `deletedSerials is number`,        String(data?.deletedSerials));
}

// ── phase 10: delete tracking scan (SAL + any residual TSN) ──────────────────

async function testDeleteTrackingScan(salId) {
  console.log(`\n── 10  Delete tracking scan  (sourceKind=tech_scan  sourceRowId=${salId})`);

  // delete-tracking with sourceKind='tech_scan' deletes:
  //   SAL rows where tech_serial_number_id IN (TSN rows for this anchor SAL)
  //   TSN rows where context_station_activity_log_id = sourceRowId
  //   the anchor SAL row itself
  // Response: { success: true, deletedCount: number }
  const { ok, status, data } = await api('/api/tech/delete-tracking', {
    sourceKind:  'tech_scan',
    sourceRowId: salId,
    techId:      TECH_ID,
  });

  assert(ok,                                     `HTTP ${status}`,                    JSON.stringify(data?.error));
  assert(data?.success === true,                 `success === true`);
  // tech/delete returns { success, deletedSerials: TSN count }
  assert(typeof data?.deletedSerials === 'number', `deletedSerials is number`,        String(data?.deletedSerials));
}

// ── phase 11: tech-logs confirms rows are gone ───────────────────────────────

async function testLogsConfirmGone(salId, fnskuSalId) {
  console.log(`\n── 11  tech-logs confirms both rows deleted`);

  const { ok, status, data } = await api(`/api/tech-logs?techId=${TECH_ID}&limit=50`);

  assert(ok,                  `HTTP ${status}`);
  assert(Array.isArray(data), `response is array`);
  if (!Array.isArray(data)) return;

  assert(
    !data.some(r => Number(r.id) === salId),
    `SAL row id=${salId} absent from tech-logs`,
  );
  assert(
    !data.some(r => Number(r.id) === fnskuSalId),
    `fba_scan SAL row id=${fnskuSalId} absent from tech-logs`,
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SAL · TSN · FBA-FNSKU  E2E  —  ${BASE}`);
  console.log(`  techId: ${TECH_ID}   run tag: ${TAG}`);
  console.log(`${'═'.repeat(60)}\n`);

  let salId     = null;
  let fnskuSalId = null;

  try {
    // ── Tracking scan path ────────────────────────────────────────────────────
    salId = await testTrackingScan();
    if (salId == null) throw new Error('Phase 1: no salId — aborting');

    await testLogsShowSAL(salId);
    await testSerialAdd(salId);
    await testLogsShowSerial(salId);
    await testSerialUndo(salId);
    await testLogsSourceKindReverts(salId);

    // ── FNSKU path ────────────────────────────────────────────────────────────
    const fnResult = await testFnskuScan();
    if (fnResult?.fnskuSalId) {
      fnskuSalId = fnResult.fnskuSalId;
      await testLogsShowFnskuRow(fnResult.fnskuSalId, fnResult.fnskuLogId);
    }

  } finally {
    // ── Cleanup — always runs ─────────────────────────────────────────────────
    console.log('\n── Cleanup ──────────────────────────────────────────────────────');

    if (fnskuSalId != null) await testDeleteFnskuScan(fnskuSalId);
    if (salId     != null)  await testDeleteTrackingScan(salId);
    if (salId != null && fnskuSalId != null) await testLogsConfirmGone(salId, fnskuSalId);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${PASS} passed   ${FAIL} failed`);

    if (FAIL === 0) {
      console.log(`  All SAL · TSN · FBA-FNSKU E2E tests passed ✓\n`);
    } else {
      console.error(`  ${FAIL} test(s) FAILED ✗\n`);
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error('\nE2E crashed:', err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
