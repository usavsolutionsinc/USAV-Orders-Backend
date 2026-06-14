import { test, expect, type Route, type Page } from '@playwright/test';

/**
 * Mobile /m/identify — LIVE label scanning, in depth.
 *
 * Everything is mocked client-side so the loop runs for real without a camera or box:
 *  - getUserMedia is overridden with canvas.captureStream (a synthetic frame).
 *  - The LAN vision box (/identify-label) and the two Vercel APIs are intercepted.
 *
 * Coverage: gate (junk rejected), happy-path lock+add, consensus (no lock without
 * agreement), no-label reads, error path, backpressure (one request in flight), and
 * re-arm for the next item.
 *
 * Runs under Chromium (--project=desktop): headless WebKit can't back getUserMedia
 * with canvas.captureStream. Self-skips on WebKit.
 *
 * Mobile emulation via test.use below.  Run:
 *   npx playwright test receiving-live-identify.spec.ts --project=desktop
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

const VISION_ORIGIN = 'https://vision.test';
const MODEL = 'Bose Wave Music System AWRCC2';

const CANDIDATE = {
  model: MODEL,
  zoho_item_id: 'z-awrcc2',
  sku: 'BOSE-WAVE-AWRCC2',
  item_name: MODEL,
  sku_catalog_id: 42,
  product_title: MODEL,
  image_url: null,
  resolved: true,
  via: 'code' as const,
};

function corsHeaders(origin: string) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}

/** Synthetic camera. 'stripes' clears the gate (sharp, static, mid-luma); 'flat' fails it. */
function installFakeCamera(page: Page, pattern: 'stripes' | 'flat') {
  return page.addInitScript((p) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const paint = () => {
      if (p === 'stripes') {
        for (let x = 0; x < canvas.width; x += 24) {
          ctx.fillStyle = (x / 24) % 2 === 0 ? '#000000' : '#ffffff';
          ctx.fillRect(x, 0, 24, canvas.height);
        }
      } else {
        ctx.fillStyle = '#888888';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    };
    paint();
    setInterval(paint, 100);
    const stream = (canvas as HTMLCanvasElement).captureStream(10);
    const getUM = async () => stream;
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, writable: true, value: getUM });
    } else {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: getUM } });
    }
  }, pattern);
}

/**
 * Wire the LAN box OCR route. `respond(hit)` returns the JSON body for the Nth read
 * (1-based); return null to send HTTP 500. Tracks hit count + max concurrency so
 * tests can assert backpressure. `delayMs` simulates a slow box.
 */
function wireBox(
  page: Page,
  appOrigin: string,
  respond: (hit: number) => Record<string, unknown> | null,
  delayMs = 0,
) {
  const state = { hits: 0, concurrent: 0, maxConcurrent: 0 };
  page.route(`${VISION_ORIGIN}/identify-label*`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders(appOrigin) });
    }
    state.hits += 1;
    state.concurrent += 1;
    state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
    const hit = state.hits;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    state.concurrent -= 1;
    const body = respond(hit);
    if (body === null) {
      return route.fulfill({ status: 500, headers: { 'content-type': 'application/json', ...corsHeaders(appOrigin) }, body: '{"detail":"boom"}' });
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', ...corsHeaders(appOrigin) }, body: JSON.stringify(body) });
  });
  return state;
}

/** Resolve route that echoes the requested model back as a resolved catalog candidate. */
function wireResolveEcho(page: Page) {
  return page.route('**/api/receiving/identify-label', async (route: Route) => {
    const models = (JSON.parse(route.request().postData() || '{}').models || []) as string[];
    const model = models[0] || MODEL;
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates: [{ ...CANDIDATE, model, item_name: model, product_title: model }] }),
    });
  });
}

function wireAdd(page: Page) {
  const state = { count: 0 };
  page.route('**/api/receiving/add-unmatched-line', (route: Route) => {
    state.count += 1;
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, line: { id: 900 + state.count } }) });
  });
  return state;
}

const okBody = { model: MODEL, loose_model: MODEL, raw_text: 'MODEL AWRCC2 SER. NO. 0123 BOSE CORP', matched: true };

test.describe('Mobile /m/identify — live (hands-free) scanning', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'fake camera (canvas.captureStream) requires Chromium');
  });

  test('happy path: auto-detects, locks on consensus, and adds the line', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    const box = wireBox(page, appOrigin, () => okBody);
    await wireResolveEcho(page);
    const add = wireAdd(page);

    const addReq = page.waitForRequest((r) => r.url().includes('/api/receiving/add-unmatched-line') && r.method() === 'POST');
    await page.goto('/m/identify?recvId=123&po=TEST');

    await expect(page.getByText(/Scanning — hold the label in view/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Confirm the product/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(MODEL).first()).toBeVisible();
    expect(box.hits).toBeGreaterThanOrEqual(2); // consensus needs ≥2 reads

    await page.getByRole('button', { name: /^Add$/ }).click();
    const req = await addReq;
    expect(req.headers()['idempotency-key']).toBeTruthy();
    const payload = JSON.parse(req.postData() || '{}');
    expect(payload.receiving_id).toBe(123);
    expect(payload.sku_catalog_id).toBe(42);
    await expect(page.getByText(/Added to PO TEST/i)).toBeVisible({ timeout: 10_000 });
    expect(add.count).toBe(1);
  });

  test('gate: a blurry/featureless frame is never sent to the box', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'flat'); // fails the sharpness gate
    const box = wireBox(page, appOrigin, () => okBody);
    await wireResolveEcho(page);
    wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');
    await expect(page.getByText(/Scanning — hold the label in view/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2500); // give the loop many ticks
    expect(box.hits).toBe(0); // on-device gate rejected every frame
    await expect(page.getByText(/Confirm the product/i)).toHaveCount(0);
  });

  test('consensus: distinct reads never lock (no false positive)', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    // A different model every read → 2-of-3 agreement is never reached.
    const box = wireBox(page, appOrigin, (hit) => ({ model: `Bose Model ${hit}`, loose_model: `Bose Model ${hit}`, raw_text: `MODEL M${hit} BOSE CORP`, matched: true }));
    await wireResolveEcho(page);
    wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');
    await expect(page.getByText(/Scanning — hold the label in view/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3000);
    expect(box.hits).toBeGreaterThanOrEqual(3); // frames were sent…
    await expect(page.getByText(/Confirm the product/i)).toHaveCount(0); // …but no consensus → no lock
  });

  test('no-label: reads with no model keep scanning, never lock', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    const box = wireBox(page, appOrigin, () => ({ model: null, loose_model: null, raw_text: 'random text', matched: false }));
    await wireResolveEcho(page);
    wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');
    await expect(page.getByText(/Scanning — hold the label in view/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    expect(box.hits).toBeGreaterThanOrEqual(2); // gate passed, frames sent
    await expect(page.getByText(/Confirm the product/i)).toHaveCount(0); // but nothing to lock on
  });

  test('error: an unreachable/500 box pauses the loop and surfaces the error sheet', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    const box = wireBox(page, appOrigin, () => null); // HTTP 500
    await wireResolveEcho(page);
    wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');
    // The error sheet replaces scanning; Retake + Search are offered.
    await expect(page.getByRole('button', { name: /Retake/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Search/i })).toBeVisible();
    const hitsAfterError = box.hits;
    await page.waitForTimeout(1500);
    expect(box.hits).toBe(hitsAfterError); // loop paused — no more requests after the error
    await expect(page.getByText(/Confirm the product/i)).toHaveCount(0);
  });

  test('backpressure: never more than one read in flight at a time', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    // Slow box (400ms > 280ms tick) + distinct models (so it keeps sending, never locks).
    const box = wireBox(page, appOrigin, (hit) => ({ model: `Bose Model ${hit}`, loose_model: `Bose Model ${hit}`, raw_text: `M${hit}`, matched: true }), 400);
    await wireResolveEcho(page);
    wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');
    await expect(page.getByText(/Scanning — hold the label in view/i)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2500);
    expect(box.hits).toBeGreaterThanOrEqual(2); // multiple serial reads happened
    expect(box.maxConcurrent).toBe(1); // …but never concurrent (latest-wins backpressure)
  });

  test('re-arm: after adding, the loop locks the next item', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page, 'stripes');
    wireBox(page, appOrigin, () => okBody);
    await wireResolveEcho(page);
    const add = wireAdd(page);

    await page.goto('/m/identify?recvId=123&po=TEST');

    // First item
    await expect(page.getByText(/Confirm the product/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByText(/Added to PO TEST/i)).toBeVisible({ timeout: 10_000 });

    // Re-arm (success sheet auto-dismisses ~1.8s) → it locks again for the next item.
    await expect(page.getByText(/Confirm the product/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByText(/Added to PO TEST/i)).toBeVisible({ timeout: 10_000 });
    expect(add.count).toBe(2);
  });

  test('manual mode keeps the shutter as a fallback', async ({ page }) => {
    await installFakeCamera(page, 'flat');
    await page.goto('/m/identify?recvId=123&po=TEST');
    await page.getByRole('button', { name: /Manual/i }).click();
    await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
    await expect(page.getByText(/Scanning — hold the label in view/i)).toHaveCount(0);
  });
});
