import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.resolve('.env'), quiet: true });

const { Client } = pg;

const PORT = Number(process.env.STATION_E2E_PORT || 3107);
const BASE_URL = process.env.STATION_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEV_SERVER_TIMEOUT_MS = 180_000;
const ITEM_TIMEOUT_MS = 25_000;
const REUSE_SERVER = process.env.STATION_E2E_REUSE_SERVER === '1';

const STAFF_ID = Number(process.env.STATION_E2E_STAFF_ID || 1);
const TEST_TRACKING = process.env.STATION_E2E_TRACKING || '1Z1A375J0332233945';
const TEST_SKU = process.env.STATION_E2E_SKU || '1370:A01';

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for live station SKU pull e2e');
  }
}

function normalizeTracking(tracking) {
  return String(tracking || '').trim().replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

async function withDb(callback) {
  requireDatabaseUrl();
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function getSnapshot(client) {
  const normalized = normalizeTracking(TEST_TRACKING);
  const shipmentResult = await client.query(
    `SELECT id, tracking_number_raw, tracking_number_normalized
     FROM shipping_tracking_numbers
     WHERE tracking_number_raw = $1 OR tracking_number_normalized = $2
     ORDER BY id DESC
     LIMIT 1`,
    [TEST_TRACKING, normalized],
  );
  const shipment = shipmentResult.rows[0] ?? null;
  assert(shipment, `No shipping_tracking_numbers row found for ${TEST_TRACKING}`);

  const shipmentId = Number(shipment.id);

  const orderResult = await client.query(
    `SELECT id, order_id, product_title, shipment_id
     FROM orders
     WHERE shipment_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [shipmentId],
  );
  const order = orderResult.rows[0] ?? null;
  assert(order, `No order found for shipment_id=${shipmentId}`);

  const skuResult = await client.query(
    `SELECT id, static_sku, serial_number, shipping_tracking_number, shipment_id
     FROM sku
     WHERE static_sku = $1
     ORDER BY id DESC
     LIMIT 1`,
    [TEST_SKU],
  );
  const sku = skuResult.rows[0] ?? null;
  assert(sku, `No sku row found for ${TEST_SKU}`);

  const salMaxResult = await client.query(
    `SELECT COALESCE(MAX(id), 0)::bigint AS max_id
     FROM station_activity_logs
     WHERE shipment_id = $1`,
    [shipmentId],
  );
  const tsnMaxResult = await client.query(
    `SELECT COALESCE(MAX(id), 0)::bigint AS max_id
     FROM tech_serial_numbers
     WHERE shipment_id = $1`,
    [shipmentId],
  );

  return {
    shipmentId,
    tracking: String(shipment.tracking_number_raw || TEST_TRACKING),
    orderId: Number(order.id),
    orderNumber: String(order.order_id || ''),
    productTitle: String(order.product_title || ''),
    skuId: Number(sku.id),
    skuStatic: String(sku.static_sku || ''),
    skuSerials: String(sku.serial_number || '')
      .split(',')
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean),
    skuTrackingNumber: sku.shipping_tracking_number ? String(sku.shipping_tracking_number) : null,
    skuShipmentId: sku.shipment_id != null ? Number(sku.shipment_id) : null,
    maxSalId: Number(salMaxResult.rows[0]?.max_id || 0),
    maxTsnId: Number(tsnMaxResult.rows[0]?.max_id || 0),
  };
}

async function getPostFlowVerification(client, snapshot) {
  const trackingSalResult = await client.query(
    `SELECT id, station, activity_type, shipment_id, scan_ref, staff_id, metadata, created_at
     FROM station_activity_logs
     WHERE shipment_id = $1
       AND activity_type = 'TRACKING_SCANNED'
       AND id > $2
     ORDER BY id DESC
     LIMIT 1`,
    [snapshot.shipmentId, snapshot.maxSalId],
  );
  const trackingSal = trackingSalResult.rows[0] ?? null;
  assert(trackingSal, 'Expected a new TRACKING_SCANNED SAL row for the e2e flow');

  const tsnResult = await client.query(
    `SELECT id, serial_number, serial_type, shipment_id, context_station_activity_log_id, source_sku_id, tested_by, created_at
     FROM tech_serial_numbers
     WHERE shipment_id = $1
       AND id > $2
     ORDER BY id ASC`,
    [snapshot.shipmentId, snapshot.maxTsnId],
  );
  const newTsnRows = tsnResult.rows;
  assert(newTsnRows.length > 0, 'Expected at least one new TSN row after the SKU pull');

  const matchingTsnRows = newTsnRows.filter((row) => Number(row.source_sku_id) === snapshot.skuId);
  assert(matchingTsnRows.length > 0, `Expected a new TSN row linked to sku.id=${snapshot.skuId}`);

  const serialsExpected = new Set(snapshot.skuSerials);
  for (const row of matchingTsnRows) {
    assert.equal(Number(row.shipment_id), snapshot.shipmentId, 'TSN shipment_id should match STN.id');
    assert.equal(
      Number(row.context_station_activity_log_id),
      Number(trackingSal.id),
      'TSN context_station_activity_log_id should match the new TRACKING_SCANNED SAL row',
    );
    assert(serialsExpected.has(String(row.serial_number || '').trim().toUpperCase()), `Unexpected TSN serial ${row.serial_number}`);
  }

  const serialAddedResult = await client.query(
    `SELECT id, activity_type, shipment_id, staff_id, tech_serial_number_id, metadata, created_at
     FROM station_activity_logs
     WHERE shipment_id = $1
       AND activity_type = 'SERIAL_ADDED'
       AND id > $2
     ORDER BY id ASC`,
    [snapshot.shipmentId, snapshot.maxSalId],
  );
  const serialAddedRows = serialAddedResult.rows;
  assert(serialAddedRows.length >= matchingTsnRows.length, 'Expected SERIAL_ADDED SAL rows for the new TSN rows');

  const serialAddedByTsnId = new Map(
    serialAddedRows
      .filter((row) => row.tech_serial_number_id != null)
      .map((row) => [Number(row.tech_serial_number_id), row]),
  );

  for (const tsnRow of matchingTsnRows) {
    const salRow = serialAddedByTsnId.get(Number(tsnRow.id));
    assert(salRow, `Expected SERIAL_ADDED SAL row for TSN ${tsnRow.id}`);
    const metadata = salRow.metadata || {};
    assert.equal(metadata.source_method, 'SKU_PULL', 'SERIAL_ADDED metadata.source_method should be SKU_PULL');
    assert.equal(Number(metadata.source_sku_id), snapshot.skuId, 'SERIAL_ADDED metadata.source_sku_id should match sku.id');
    assert.equal(String(metadata.source_sku_code || ''), snapshot.skuStatic, 'SERIAL_ADDED metadata.source_sku_code should match static_sku');
    assert.equal(
      Number(metadata.context_station_activity_log_id),
      Number(trackingSal.id),
      'SERIAL_ADDED metadata context SAL should match the tracking SAL row',
    );
  }

  const updatedSkuResult = await client.query(
    `SELECT id, static_sku, shipping_tracking_number, shipment_id, updated_at
     FROM sku
     WHERE id = $1
     LIMIT 1`,
    [snapshot.skuId],
  );
  const updatedSku = updatedSkuResult.rows[0] ?? null;
  assert(updatedSku, `Expected sku.id=${snapshot.skuId} to still exist`);
  assert.equal(
    String(updatedSku.shipping_tracking_number || ''),
    snapshot.tracking,
    'SKU.shipping_tracking_number should be linked to the scanned tracking number',
  );
  assert.equal(
    Number(updatedSku.shipment_id),
    snapshot.shipmentId,
    'SKU.shipment_id should point to the STN row',
  );

  return {
    trackingSal,
    matchingTsnRows,
    serialAddedRows,
    updatedSku,
  };
}

async function waitForServer(url, childOrNull) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_TIMEOUT_MS) {
    if (childOrNull?.exitCode != null) {
      throw new Error(`Dev server exited early with code ${childOrNull.exitCode}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 307 || response.status === 308) return;
    } catch {
      // server not ready yet
    }
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
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(`${BASE_URL}/tech?staffId=${STAFF_ID}`, child);
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

async function scan(page, value) {
  const input = page.getByPlaceholder('ORDERS, FNSKU, RS, SN');
  await input.fill(value);
  await input.press('Enter');
}

async function waitForBodyText(page, fragment, timeout = ITEM_TIMEOUT_MS) {
  try {
    await page.waitForFunction(
      (text) => document.body.innerText.toUpperCase().includes(String(text).toUpperCase()),
      fragment,
      { timeout },
    );
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const excerpt = bodyText.slice(0, 4000);
    throw new Error(
      `Timed out waiting for body text "${fragment}".\n--- body excerpt ---\n${excerpt}\n--- end excerpt ---\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runUiFlow(snapshot) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  try {
    await page.goto(`${BASE_URL}/tech?staffId=${STAFF_ID}`, { waitUntil: 'networkidle' });
    await page.getByPlaceholder('ORDERS, FNSKU, RS, SN').waitFor({ state: 'visible', timeout: ITEM_TIMEOUT_MS });

    const trackingResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/tech/scan') && response.request().method() === 'POST',
      { timeout: ITEM_TIMEOUT_MS },
    );
    await scan(page, snapshot.tracking);
    const trackingResponse = await trackingResponsePromise;
    const trackingPayload = await trackingResponse.json();
    assert.equal(trackingResponse.ok(), true, `Tracking scan HTTP failed: ${trackingResponse.status()}`);
    assert.equal(trackingPayload?.found, true, `Tracking scan failed: ${JSON.stringify(trackingPayload)}`);
    await waitForBodyText(page, snapshot.productTitle || 'BOSE');

    const skuResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/tech/scan-sku') && response.request().method() === 'POST',
      { timeout: ITEM_TIMEOUT_MS },
    );
    await scan(page, TEST_SKU);
    const skuResponse = await skuResponsePromise;
    const skuPayload = await skuResponse.json();
    assert.equal(skuResponse.ok(), true, `SKU scan HTTP failed: ${skuResponse.status()} ${JSON.stringify(skuPayload)}`);
    assert.equal(skuPayload?.success, true, `SKU scan failed: ${JSON.stringify(skuPayload)}`);
    await waitForBodyText(page, 'STORAGE SKUS');
    await waitForBodyText(page, 'SCANNED SERIALS');
    for (const serial of snapshot.skuSerials) {
      await waitForBodyText(page, serial);
    }
    await waitForBodyText(page, snapshot.skuStatic);

    assert.equal(pageErrors.length, 0, `Page errors detected:\n${pageErrors.map((error) => error.message).join('\n')}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const before = await withDb(getSnapshot);
  const server = REUSE_SERVER ? null : await startDevServer();
  if (REUSE_SERVER) {
    await waitForServer(`${BASE_URL}/tech?staffId=${STAFF_ID}`, null);
  }

  try {
    await runUiFlow(before);
  } finally {
    await stopDevServer(server?.child);
  }

  const after = await withDb((client) => getPostFlowVerification(client, before));

  console.log('\nStation SKU pull E2E passed');
  console.log(`Tracking: ${before.tracking}`);
  console.log(`STN.id: ${before.shipmentId}`);
  console.log(`Order DB id: ${before.orderId} (${before.orderNumber})`);
  console.log(`SKU.id: ${before.skuId} (${before.skuStatic})`);
  console.log(`Tracking SAL.id: ${after.trackingSal.id}`);
  console.log(`TSN ids: ${after.matchingTsnRows.map((row) => row.id).join(', ')}`);
  console.log(`SERIAL_ADDED SAL ids: ${after.serialAddedRows.map((row) => row.id).join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
