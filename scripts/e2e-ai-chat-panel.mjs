import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.AI_E2E_PORT || 3106);
const BASE_URL = process.env.AI_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const DEV_SERVER_TIMEOUT_MS = 120_000;
const REUSE_SERVER = process.env.AI_E2E_REUSE_SERVER === '1';
const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < DEV_SERVER_TIMEOUT_MS) {
    if (child?.exitCode != null) {
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
    stdio: 'pipe',
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[dev] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[dev] ${chunk}`);
  });

  await waitForServer(`${BASE_URL}/ai`, child);
  return child;
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

async function installApiMocks(page) {
  let chatCount = 0;

  await page.route('**/api/ai/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (url.pathname === '/api/ai/tunnel-session' && method === 'POST') {
      return json(route, 200, { session_id: 'e2e-session' });
    }

    if (url.pathname === '/api/ai/tunnel-health' && method === 'GET') {
      return json(route, 503, {
        ok: false,
        local_ops: true,
        error: 'Model backend offline',
      });
    }

    if (url.pathname === '/api/ai/tunnel-chat' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const message = String(body.message || '');
      chatCount += 1;

      if (/missing a tester/i.test(message)) {
        return json(route, 200, {
          reply: '2 shipped orders were missing a tester for March 16, 2026 to March 20, 2026 PST.',
          sessionId: 'e2e-session',
          mode: 'local_ops',
          analysis: {
            kind: 'shipping_summary',
            title: 'Shipped Orders Missing Tester',
            summary: '2 shipped orders were missing a tester for March 16, 2026 to March 20, 2026 PST.',
            confidence: 'high',
            modeLabel: 'Local Ops Query',
            timeframe: {
              kind: 'last_week',
              label: 'Last Week',
              exactLabel: 'March 16, 2026 to March 20, 2026 PST',
              start: '2026-03-16',
              end: '2026-03-20',
              timezone: 'America/Los_Angeles',
              explicit: true,
              weekOffset: 1,
            },
            metrics: [
              { label: 'Rows missing attribution', value: '2', detail: 'Counted from March 16, 2026 to March 20, 2026 PST' },
              { label: 'Attribution field', value: 'tester', detail: 'Rows where the shipped order has no operator on that field' },
              { label: 'Recent sample rows', value: '2', detail: 'Open sample rows below for details' },
            ],
            sampleTitle: 'Recent shipped rows in range',
            sampleRecords: [
              {
                id: '1',
                primary: '100-1111-2222 · Sony Camera',
                secondary: 'Packed 2026-03-18 11:14:00 | Packer Tuan',
                href: '/dashboard?shipped=&search=100-1111-2222',
              },
            ],
            sources: [
              { id: 'shipped-query', label: 'Shipped orders query', detail: 'Uses the same shipped-order route filters as the dashboard.' },
            ],
            followUps: [
              'How many orders were shipped last week and by who?',
            ],
            actions: [
              { label: 'Open shipped table', href: '/dashboard?shipped=&shippedWeekOffset=1' },
            ],
          },
        });
      }

      return json(route, 200, {
        reply: '12 shipped orders were recorded for March 16, 2026 to March 20, 2026 PST. Breakdown by packed: Tuan led with 7, followed by Thuy at 5.',
        sessionId: 'e2e-session',
        mode: 'local_ops',
        analysis: {
          kind: 'shipping_summary',
          title: 'Shipped Orders By Packer',
          summary: '12 shipped orders were recorded for March 16, 2026 to March 20, 2026 PST.',
          confidence: 'high',
          modeLabel: 'Local Ops Query',
          timeframe: {
            kind: 'last_week',
            label: 'Last Week',
            exactLabel: 'March 16, 2026 to March 20, 2026 PST',
            start: '2026-03-16',
            end: '2026-03-20',
            timezone: 'America/Los_Angeles',
            explicit: true,
            weekOffset: 1,
          },
          metrics: [
            { label: 'Total shipped', value: '12', detail: 'Counted from March 16, 2026 to March 20, 2026 PST' },
            { label: 'Packers listed', value: '2', detail: 'All rows attributed' },
            { label: 'Top operator', value: 'Tuan', detail: '7 shipped orders' },
          ],
          breakdownTitle: 'Packer breakdown',
          breakdown: [
            { id: '4:Tuan', label: 'Tuan', value: 7, href: '/packer?staffId=4' },
            { id: '5:Thuy', label: 'Thuy', value: 5, href: '/packer?staffId=5' },
          ],
          sampleTitle: 'Recent shipped rows in range',
          sampleRecords: [
            {
              id: '1',
              primary: '100-1111-2222 · Sony Camera',
              secondary: 'Packed 2026-03-18 11:14:00 | Packer Tuan',
              href: '/dashboard?shipped=&search=100-1111-2222',
            },
          ],
          sources: [
            { id: 'shipped-query', label: 'Shipped orders query', detail: 'Uses the same shipped-order route filters as the dashboard.' },
            { id: 'packing', label: 'packer_logs', detail: 'Packing timestamps and packer attribution.' },
          ],
          followUps: [
            'Which shipped orders last week are missing a tester?',
          ],
          actions: [
            { label: 'Open shipped table', href: '/dashboard?shipped=&shippedWeekOffset=1' },
          ],
        },
      });
    }

    return route.continue();
  });

  return () => chatCount;
}

async function run() {
  let devServer = null;
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });
  const page = await browser.newPage();
  const getChatCount = await installApiMocks(page);

  try {
    if (!REUSE_SERVER) {
      devServer = await startDevServer();
    } else {
      await waitForServer(`${BASE_URL}/ai`);
    }

    await page.goto(`${BASE_URL}/ai`, { waitUntil: 'networkidle' });

    await page.getByText('Ask shipped-count questions in plain English', { exact: false }).waitFor();
    await page.getByRole('button', { name: /How many orders were shipped last week and by who\?/i }).click();

    await page.getByText('Shipped Orders By Packer').waitFor();
    await page.getByText('12 shipped orders were recorded for March 16, 2026 to March 20, 2026 PST.').waitFor();
    await page.getByText('Tuan').waitFor();
    await page.getByRole('link', { name: 'Open shipped table' }).waitFor();

    const shippedLink = page.getByRole('link', { name: 'Open shipped table' }).first();
    await assert.doesNotReject(async () => {
      const href = await shippedLink.getAttribute('href');
      assert.equal(href, '/dashboard?shipped=&shippedWeekOffset=1');
    });

    await page.getByRole('button', { name: /Which shipped orders last week are missing a tester\?/i }).click();
    await page.getByText('Shipped Orders Missing Tester').waitFor();

    assert.equal(getChatCount(), 2, 'expected exactly two mocked chat requests');
    console.log('AI chat panel E2E passed');
  } finally {
    await browser.close();
    if (devServer && devServer.exitCode == null) {
      devServer.kill('SIGTERM');
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
