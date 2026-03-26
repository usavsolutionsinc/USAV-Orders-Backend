/**
 * E2E test: StationTesting serial-scan anchoring
 *
 * Verifies three critical paths after the handleFnskuScan routing fix:
 *
 *  1. FNSKU scan → serial scan
 *     - Active order card appears after FNSKU scan (syncActiveOrderState was called)
 *     - Serial routes to /api/tech/add-serial (not add-serial-to-last)
 *     - No "not found" alert fires
 *     - Card stays visible with the serial listed
 *
 *  2. FNSKU scan → 12-digit carrier-pattern serial (previously misrouted as TRACKING)
 *     - Serial still goes to /api/tech/add-serial
 *     - No "not found" alert fires
 *
 *  3. Regular tracking scan → serial scan (regression check)
 *     - Card appears after tracking scan
 *     - Serial routes to /api/tech/add-serial
 *     - Card stays visible
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.STATION_E2E_PORT || 3106);
const BASE_URL = process.env.STATION_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEV_SERVER_TIMEOUT_MS = 180_000;
const ITEM_TIMEOUT_MS = 20_000;
const REUSE_SERVER = process.env.STATION_E2E_REUSE_SERVER === '1';

// Valid FNSKU: X0 + 8 alphanumeric chars (matches looksLikeFnsku regex)
const TEST_FNSKU = 'X00TESTA01';
const TEST_FNSKU_PRODUCT = 'Test FBA Product Alpha';
const TEST_FNSKU_TRACKING = 'FBA123456789'; // assigned by scan-fnsku response

const TEST_TRACKING = '1ZA12345678901234'; // UPS-like tracking
const TEST_ORDER_PRODUCT = 'Regular Order Item';
const TEST_ORDER_ID = 'USV-20001';

// ── helpers ───────────────────────────────────────────────────────────────────

function json(route, status, body) {
  return route.fulfill({
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  });
}

function makeFnskuScanResponse(fnsku) {
  return {
    found: true,
    orderFound: true,
    fnskuLogId: 9001,
    fnskuSalId: 9001,
    summary: { tech_scanned_qty: 0, pack_ready_qty: 0, shipped_qty: 0, available_to_ship: 1 },
    shipment: { shipment_ref: 'SHIP-TEST' },
    order: {
      id: 501,
      orderId: fnsku,
      productTitle: TEST_FNSKU_PRODUCT,
      sku: 'TEST-SKU-001',
      condition: 'Used - Good',
      notes: '',
      tracking: TEST_FNSKU_TRACKING,
      serialNumbers: [],
      testDateTime: null,
      testedBy: null,
      quantity: 1,
      shipByDate: null,
      createdAt: null,
      outOfStock: false,
      status: 'PENDING',
      statusHistory: [],
      accountSource: 'fba',
    },
  };
}

function makeTrackingScanResponse(tracking) {
  return {
    found: true,
    orderFound: true,
    scanSessionId: 'sess-tracking-001',
    order: {
      id: 301,
      orderId: TEST_ORDER_ID,
      productTitle: TEST_ORDER_PRODUCT,
      sku: 'REG-SKU-001',
      condition: 'Used - Good',
      notes: '',
      tracking,
      serialNumbers: [],
      testDateTime: null,
      testedBy: null,
      quantity: 1,
      shipByDate: null,
      createdAt: null,
      orderFound: true,
      sourceType: 'orders',
    },
  };
}

function makeAddSerialResponse(serial) {
  return {
    success: true,
    serialNumbers: [serial],
    isComplete: false,
    scanSessionId: 'sess-serial-001',
  };
}

// ── API mock installer ────────────────────────────────────────────────────────

async function installApiMocks(page, calls) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method().toUpperCase();

    // Staff list
    if (pathname === '/api/staff') {
      return json(route, 200, [
        { id: 1, name: 'Lien', role: 'technician' },
        { id: 2, name: 'Michael', role: 'technician' },
      ]);
    }

    // Tech logs (TechTable / StationHistory)
    if (pathname === '/api/tech-logs') {
      return json(route, 200, { logs: [], total: 0 });
    }

    // Up-next orders
    if (pathname === '/api/orders/next' || pathname === '/api/tech/up-next') {
      return json(route, 200, { orders: [], items: [] });
    }

    // Assignments next
    if (pathname === '/api/assignments/next') {
      return json(route, 200, { assignment: null });
    }

    // Repair station (ignored)
    if (pathname === '/api/tech/scan-repair-station') {
      return json(route, 200, { found: false });
    }

    // Manuals resolve
    if (pathname === '/api/manuals/resolve') {
      return json(route, 200, { manuals: [] });
    }

    // FNSKU scan
    if (pathname === '/api/tech/scan-fnsku' && method === 'GET') {
      const fnsku = String(searchParams.get('fnsku') || '').toUpperCase();
      calls.fnskuScanned.push(fnsku);
      return json(route, 200, makeFnskuScanResponse(fnsku));
    }

    // Tracking scan
    if (pathname === '/api/tech/scan-tracking' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch { /* */ }
      calls.trackingScanned.push(String(body.tracking || ''));
      const trk = String(body.tracking || '');
      return json(route, 200, makeTrackingScanResponse(trk));
    }

    // Add serial — PRIMARY path
    if (pathname === '/api/tech/add-serial' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch { /* */ }
      const serial = String(body.serial || '').toUpperCase();
      calls.serialAdded.push({ serial, tracking: body.tracking });
      return json(route, 200, makeAddSerialResponse(serial));
    }

    // Add serial to last — FALLBACK path (should NOT be called in normal flows)
    if (pathname === '/api/tech/add-serial-to-last' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(request.postData() || '{}'); } catch { /* */ }
      calls.serialAddedToLast.push(String(body.serial || '').toUpperCase());
      return json(route, 200, makeAddSerialResponse(String(body.serial || '').toUpperCase()));
    }

    // SKU by-tracking (prepacked SKU lookup used by ShippedDetailsPanelContent)
    if (pathname === '/api/sku/by-tracking') {
      return json(route, 200, { found: false });
    }

    // Catch-all: return empty success to avoid network errors blocking the UI
    return json(route, 200, {});
  });
}

// ── test helpers ──────────────────────────────────────────────────────────────

async function scan(page, value) {
  const input = page.getByPlaceholder('ORDERS, FNSKU, RS, SN');
  await input.fill(value);
  await input.press('Enter');
}

async function waitForCardTitle(page, titleFragment) {
  await page.waitForFunction(
    (frag) => {
      const texts = Array.from(document.querySelectorAll('[class*="font-black"]')).map((el) => el.textContent || '');
      return texts.some((t) => t.toLowerCase().includes(frag.toLowerCase()));
    },
    titleFragment,
    { timeout: ITEM_TIMEOUT_MS },
  );
}

async function assertNoNotFoundAlert(page) {
  // "not found" alert has role="status" and aria-live="polite"
  const alert = page.locator('[role="status"][aria-live="polite"]');
  const count = await alert.count();
  if (count === 0) return; // no alert rendered at all — good
  const text = await alert.textContent().catch(() => '');
  assert(
    !text || text.trim() === '',
    `Expected no "not found" alert, but found: "${text?.trim()}"`,
  );
}

// ── flow tests ────────────────────────────────────────────────────────────────

/**
 * Flow 1: FNSKU scan followed by a regular serial number.
 * - Card must appear after FNSKU scan (proves syncActiveOrderState was called).
 * - Serial must route to /api/tech/add-serial (not add-serial-to-last).
 * - No "tracking not found" alert.
 * - Card stays visible with the serial listed.
 */
async function testFnskuThenSerial(browser) {
  const calls = { fnskuScanned: [], trackingScanned: [], serialAdded: [], serialAddedToLast: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await installApiMocks(page, calls);
  await page.goto(`${BASE_URL}/tech?staffId=2`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('ORDERS, FNSKU, RS, SN').waitFor({ state: 'visible', timeout: ITEM_TIMEOUT_MS });

  // ── Step 1: scan FNSKU ────────────────────────────────────────────────────
  await scan(page, TEST_FNSKU);

  // Card must become visible
  await waitForCardTitle(page, TEST_FNSKU_PRODUCT);
  assert.equal(calls.fnskuScanned.length, 1, 'FNSKU scan endpoint should have been called once');

  // No "not found" alert
  await assertNoNotFoundAlert(page);

  // ── Step 2: scan a regular serial ────────────────────────────────────────
  const serial1 = 'SNABCDE12345';
  await scan(page, serial1);

  await page.waitForFunction(
    (sn) => document.body.innerText.includes(sn),
    serial1,
    { timeout: ITEM_TIMEOUT_MS },
  );

  // add-serial must have been called — NOT add-serial-to-last
  assert.equal(calls.serialAdded.length, 1, 'Expected exactly 1 call to /api/tech/add-serial');
  assert.equal(calls.serialAddedToLast.length, 0, '/api/tech/add-serial-to-last should NOT be called');
  assert.equal(
    calls.serialAdded[0].serial,
    serial1.toUpperCase(),
    `Expected serial "${serial1}" sent to add-serial`,
  );

  // Card still visible (not cleared)
  await waitForCardTitle(page, TEST_FNSKU_PRODUCT);

  // No "not found" alert at any point
  await assertNoNotFoundAlert(page);

  assert.equal(pageErrors.length, 0, `Page errors in FNSKU→serial flow:\n${pageErrors.map((e) => e.message).join('\n')}`);
  await page.close();
  console.log('  ✓ Flow 1: FNSKU scan → serial scan');
}

/**
 * Flow 2: FNSKU scan followed by a 12-digit numeric serial (previously misrouted as FedEx tracking).
 * - Serial must route to /api/tech/add-serial (not tracking lookup).
 * - No "not found" alert fires.
 */
async function testFnskuThenCarrierPatternSerial(browser) {
  const calls = { fnskuScanned: [], trackingScanned: [], serialAdded: [], serialAddedToLast: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await installApiMocks(page, calls);
  await page.goto(`${BASE_URL}/tech?staffId=2`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('ORDERS, FNSKU, RS, SN').waitFor({ state: 'visible', timeout: ITEM_TIMEOUT_MS });

  // ── Step 1: scan FNSKU ────────────────────────────────────────────────────
  await scan(page, TEST_FNSKU);
  await waitForCardTitle(page, TEST_FNSKU_PRODUCT);

  // ── Step 2: scan 12-digit serial (carrier-lookalike) ─────────────────────
  const carrierSerial = '123456789012'; // 12-digit number — FedEx pattern
  await scan(page, carrierSerial);

  // Wait for add-serial to be called
  await page.waitForFunction(
    () => window.__stationE2eSerialCalls?.length > 0 || true,
    {},
    { timeout: 500 },
  ).catch(() => {});

  // Give the async handler time to fire
  await delay(1500);

  // add-serial called (not tracking scan, not add-serial-to-last)
  assert.equal(calls.trackingScanned.length, 0, 'Carrier-pattern serial should NOT trigger a tracking scan');
  assert.equal(calls.serialAddedToLast.length, 0, '/api/tech/add-serial-to-last should NOT be called');
  assert.equal(calls.serialAdded.length, 1, 'Expected exactly 1 call to /api/tech/add-serial');
  assert.equal(
    calls.serialAdded[0].serial,
    carrierSerial.toUpperCase(),
    `Expected carrier-pattern serial "${carrierSerial}" sent to add-serial`,
  );

  // No "not found" alert
  await assertNoNotFoundAlert(page);

  assert.equal(pageErrors.length, 0, `Page errors in FNSKU→carrier-serial flow:\n${pageErrors.map((e) => e.message).join('\n')}`);
  await page.close();
  console.log('  ✓ Flow 2: FNSKU scan → carrier-pattern serial (no misroute)');
}

/**
 * Flow 3: Regular tracking scan → serial scan (regression).
 * - Card must appear after tracking scan.
 * - Serial routes to /api/tech/add-serial.
 * - Card stays visible.
 */
async function testTrackingThenSerial(browser) {
  const calls = { fnskuScanned: [], trackingScanned: [], serialAdded: [], serialAddedToLast: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await installApiMocks(page, calls);
  await page.goto(`${BASE_URL}/tech?staffId=2`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('ORDERS, FNSKU, RS, SN').waitFor({ state: 'visible', timeout: ITEM_TIMEOUT_MS });

  // ── Step 1: scan tracking number ─────────────────────────────────────────
  await scan(page, TEST_TRACKING);
  await waitForCardTitle(page, TEST_ORDER_PRODUCT);
  assert.equal(calls.trackingScanned.length, 1, 'Tracking scan endpoint should have been called once');

  // ── Step 2: scan a serial ─────────────────────────────────────────────────
  const serial2 = 'SNXYZ9876543';
  await scan(page, serial2);

  await page.waitForFunction(
    (sn) => document.body.innerText.includes(sn),
    serial2,
    { timeout: ITEM_TIMEOUT_MS },
  );

  assert.equal(calls.serialAdded.length, 1, 'Expected exactly 1 call to /api/tech/add-serial');
  assert.equal(calls.serialAddedToLast.length, 0, '/api/tech/add-serial-to-last should NOT be called');
  assert.equal(
    calls.serialAdded[0].serial,
    serial2.toUpperCase(),
    `Expected serial "${serial2}" sent to add-serial`,
  );

  await waitForCardTitle(page, TEST_ORDER_PRODUCT);
  await assertNoNotFoundAlert(page);

  assert.equal(pageErrors.length, 0, `Page errors in tracking→serial flow:\n${pageErrors.map((e) => e.message).join('\n')}`);
  await page.close();
  console.log('  ✓ Flow 3: Tracking scan → serial scan (regression)');
}

// ── server management ─────────────────────────────────────────────────────────

async function waitForServer(url, childOrNull) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_TIMEOUT_MS) {
    if (childOrNull?.exitCode != null) {
      throw new Error(`Dev server exited early with code ${childOrNull.exitCode}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 307 || response.status === 308) return;
    } catch { /* not ready */ }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function startDevServer() {
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer(`${BASE_URL}/tech`, child);
    return { child, stdoutRef: () => stdout, stderrRef: () => stderr };
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
    );
  }
}

async function stopDevServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await delay(1500);
  if (child.exitCode == null) child.kill('SIGKILL');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const server = REUSE_SERVER ? null : await startDevServer();
  if (REUSE_SERVER) {
    await waitForServer(`${BASE_URL}/tech`, null);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  console.log(`\nStation serial E2E — ${BASE_URL}\n`);

  try {
    await testFnskuThenSerial(browser);
    await testFnskuThenCarrierPatternSerial(browser);
    await testTrackingThenSerial(browser);
    console.log('\nAll station serial E2E tests passed ✓\n');
  } finally {
    await browser.close();
    await stopDevServer(server?.child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
