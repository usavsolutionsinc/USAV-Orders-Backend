import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.FBA_E2E_PORT || 3105);
const BASE_URL = process.env.FBA_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEV_SERVER_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 15_000;
const REUSE_SERVER = process.env.FBA_E2E_REUSE_SERVER === '1';

function buildCatalog() {
  const catalog = new Map();
  for (let i = 1; i <= 24; i += 1) {
    const suffix = String(i).padStart(4, '0');
    const fnsku = `X0ITEM${suffix}`;
    catalog.set(fnsku, {
      fnsku,
      found: true,
      product_title: `Catalog item ${suffix}`,
      asin: `B0CAT${suffix}`,
      sku: `SKU-${suffix}`,
    });
  }
  for (let i = 1; i <= 4; i += 1) {
    const suffix = String(i).padStart(4, '0');
    const fnsku = `X0PLAN${suffix}`;
    catalog.set(fnsku, {
      fnsku,
      found: true,
      product_title: `Planned item ${suffix}`,
      asin: `B0PLAN${suffix}`,
      sku: `PLAN-${suffix}`,
    });
  }
  return catalog;
}

function buildState() {
  const catalog = buildCatalog();
  const items = Array.from({ length: 4 }, (_, index) => {
    const i = index + 1;
    const suffix = String(i).padStart(4, '0');
    return {
      id: i,
      fnsku: `X0PLAN${suffix}`,
      display_title: `Planned item ${suffix}`,
      product_title: `Planned item ${suffix}`,
      asin: `B0PLAN${suffix}`,
      sku: `PLAN-${suffix}`,
      expected_qty: 1,
      status: 'PLANNED',
      notes: null,
      ready_by_staff_id: null,
      ready_by_name: null,
      verified_by_staff_id: null,
      verified_by_name: null,
    };
  });

  return {
    shipmentId: 101,
    shipmentRef: 'PLAN-101',
    dueDate: '2026-03-26',
    nextItemId: 1000,
    catalog,
    items,
  };
}

function buildShipmentsSummary(state) {
  const totalItems = state.items.length;
  const totalExpectedQty = state.items.reduce((sum, item) => sum + Number(item.expected_qty || 0), 0);
  const readyItemCount = state.items.filter((item) => item.status === 'READY_TO_GO').length;
  const shippedItemCount = state.items.filter((item) => item.status === 'SHIPPED').length;
  return {
    id: state.shipmentId,
    shipment_ref: state.shipmentRef,
    due_date: state.dueDate,
    total_items: totalItems,
    total_expected_qty: totalExpectedQty,
    ready_item_count: readyItemCount,
    shipped_item_count: shippedItemCount,
    created_by_name: 'Michael',
    created_at: '2026-03-26T08:00:00.000Z',
  };
}

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

async function installApiMocks(page, state) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method().toUpperCase();

    if (pathname === '/api/staff' && searchParams.get('active') === 'true') {
      return json(route, 200, [
        { id: 1, name: 'Lien', role: 'technician' },
        { id: 2, name: 'Michael', role: 'technician' },
        { id: 4, name: 'Tuan', role: 'packer' },
        { id: 5, name: 'Thuy', role: 'packer' },
      ]);
    }

    if (pathname === '/api/fba/shipments' && method === 'GET') {
      const status = searchParams.get('status');
      if (status === 'PLANNED' || status === 'PLANNED,PACKING,READY_TO_GO,OUT_OF_STOCK,LABEL_ASSIGNED') {
        return json(route, 200, { shipments: [buildShipmentsSummary(state)] });
      }
    }

    if (pathname === `/api/fba/shipments/${state.shipmentId}` && method === 'GET') {
      return json(route, 200, {
        shipment: {
          ...buildShipmentsSummary(state),
          amazon_shipment_id: null,
          tracking_numbers: [],
        },
      });
    }

    if (pathname === `/api/fba/shipments/${state.shipmentId}/items` && method === 'GET') {
      return json(route, 200, { items: state.items });
    }

    if (pathname === `/api/fba/shipments/${state.shipmentId}/items` && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const fnsku = String(body.fnsku || '').trim().toUpperCase();
      const catalogRow = state.catalog.get(fnsku);
      if (!catalogRow) {
        return json(route, 400, { success: false, error: 'FNSKU not in catalog' });
      }
      const nextItem = {
        id: state.nextItemId,
        fnsku,
        display_title: String(body.product_title || catalogRow.product_title || fnsku),
        product_title: String(body.product_title || catalogRow.product_title || fnsku),
        asin: body.asin ?? catalogRow.asin ?? null,
        sku: body.sku ?? catalogRow.sku ?? null,
        expected_qty: Math.max(1, Number(body.expected_qty || 1)),
        status: 'PLANNED',
        notes: null,
        ready_by_staff_id: null,
        ready_by_name: null,
        verified_by_staff_id: null,
        verified_by_name: null,
      };
      state.nextItemId += 1;
      state.items.push(nextItem);
      return json(route, 200, { success: true, item: nextItem });
    }

    if (pathname === '/api/fba/fnskus/validate' && method === 'GET') {
      const raw = String(searchParams.get('fnskus') || '');
      const persistMissing = new Set(['1', 'true', 'yes']).has(
        String(searchParams.get('persist_missing') || '').trim().toLowerCase(),
      );
      const fnskus = raw
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      const results = fnskus.map((fnsku) => {
        const match = state.catalog.get(fnsku);
        if (match) return match;
        if (persistMissing) {
          const stub = {
            fnsku,
            found: false,
            catalog_exists: true,
            needs_details: true,
            upserted_stub: true,
            product_title: null,
            asin: null,
            sku: null,
          };
          state.catalog.set(fnsku, stub);
          return stub;
        }
        return {
          fnsku,
          found: false,
          catalog_exists: false,
          needs_details: false,
          upserted_stub: false,
          product_title: null,
          asin: null,
          sku: null,
        };
      });
      return json(route, 200, { success: true, results });
    }

    if (pathname === '/api/tech/scan-fnsku' && method === 'GET') {
      const fnsku = String(searchParams.get('fnsku') || '').trim().toUpperCase();
      const catalogRow = state.catalog.get(fnsku);
      return json(route, 200, {
        found: true,
        fnskuLogId: 9001,
        summary: {
          tech_scanned_qty: 4,
          pack_ready_qty: 1,
          shipped_qty: 0,
          available_to_ship: 3,
        },
        shipment: {
          shipment_ref: state.shipmentRef,
        },
        order: {
          id: 1,
          orderId: fnsku,
          productTitle: catalogRow?.product_title || fnsku,
          sku: catalogRow?.sku || fnsku,
          tracking: fnsku,
        },
      });
    }

    if (pathname.startsWith('/api/fba/shipments/') && method === 'PATCH') {
      return json(route, 200, { success: true });
    }

    return json(route, 200, {});
  });
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_TIMEOUT_MS) {
    if (child.exitCode != null) {
      throw new Error(`Dev server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok || response.status === 307 || response.status === 308) return;
    } catch {
      // not ready yet
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
    await waitForServer(`${BASE_URL}/fba`, child);
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

async function expectScrollable(locator, label, page) {
  const handle = await locator.elementHandle();
  assert(handle, `Missing scroll container for ${label}`);
  await page.waitForFunction((node) => node.scrollHeight > node.clientHeight, handle, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  await locator.hover();
  await page.mouse.wheel(0, 800);
  let metrics = await locator.evaluate((node) => ({
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  }));
  if (metrics.scrollTop <= 0) {
    await locator.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    metrics = await locator.evaluate((node) => ({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
  }
  assert(metrics.scrollHeight > metrics.clientHeight, `${label} never overflowed`);
  assert(metrics.scrollTop > 0, `${label} did not scroll`);
}

async function runBlueThemeFlow(browser) {
  const state = buildState();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await installApiMocks(page, state);

  await page.goto(`${BASE_URL}/fba?main=plan&plan=101&staffId=2`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('FNSKU (X00…)').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });

  const bulkFnskus = Array.from({ length: 20 }, (_, index) => `X0ITEM${String(index + 1).padStart(4, '0')}`);
  await page.getByPlaceholder('FNSKU (X00…)').fill(bulkFnskus.join('\n'));
  await page.getByText('Pasted FNSKU validation').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });

  const validationSection = page.getByTestId('fba-bulk-validation-section');
  await validationSection.waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
  assert.equal(
    await page.locator('div.max-h-64.overflow-y-auto').count(),
    0,
    'Expected bulk validation to use the sidebar scroll instead of an inner viewport',
  );
  const sidebarScroll = page.getByTestId('fba-sidebar-scroll');
  await expectScrollable(sidebarScroll, 'FBA sidebar', page);

  await page.getByLabel(`Increase ${bulkFnskus[19]} quantity`).click();
  await page.getByPlaceholder('FNSKU (X00…)').focus();
  await page.keyboard.press('Enter');
  await page.getByText(/Added 20 FNSKU row/).waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
  const addedRow = state.items.find((item) => item.fnsku === bulkFnskus[19]);
  assert(addedRow, `Expected ${bulkFnskus[19]} to be added to plan state`);
  assert.equal(addedRow.expected_qty, 2, `Expected ${bulkFnskus[19]} qty to be incremented before submit`);

  for (const fnsku of bulkFnskus.slice(0, 10)) {
    await page.getByRole('checkbox', { name: `Add ${fnsku} to print sidebar` }).click();
  }

  await page.getByText('Selected items').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
  assert.equal(
    await page.locator('div.max-h-56.overflow-y-auto').count(),
    0,
    'Expected selected items to participate in the main sidebar scroll instead of a nested viewport',
  );

  assert.equal(pageErrors.length, 0, `Unexpected page errors in blue flow: ${pageErrors.map((err) => err.message).join('\n')}`);
  await page.close();
}

async function runRedThemeSmoke(browser) {
  const state = buildState();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await installApiMocks(page, state);

  await page.goto(`${BASE_URL}/fba?main=plan&plan=101&staffId=5`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('FNSKU (X00…)').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
  await page.getByPlaceholder('FNSKU (X00…)').fill(['X0ITEM0001', 'X0MISS001'].join('\n'));
  await page.getByText('Pasted FNSKU validation').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });

  const headerClass = await page.getByText('Pasted FNSKU validation').getAttribute('class');
  assert(headerClass?.includes('text-red-700'), `Expected red validation title for packer theme, got: ${headerClass}`);
  await page.getByText('Saved for later completion').waitFor({ state: 'visible', timeout: REQUEST_TIMEOUT_MS });
  assert.equal(
    await page.getByText(/fba_fnskus|fba_skus/i).count(),
    0,
    'Expected no raw table names in pasted validation messaging',
  );
  assert.equal(pageErrors.length, 0, `Unexpected page errors in red flow: ${pageErrors.map((err) => err.message).join('\n')}`);
  await page.close();
}

async function main() {
  const server = REUSE_SERVER ? null : await startDevServer();
  if (REUSE_SERVER) {
    await waitForServer(`${BASE_URL}/fba`, { exitCode: null });
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  try {
    await runBlueThemeFlow(browser);
    await runRedThemeSmoke(browser);
    console.log(`FBA sidebar E2E passed at ${BASE_URL}`);
  } finally {
    await browser.close();
    await stopDevServer(server?.child);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
