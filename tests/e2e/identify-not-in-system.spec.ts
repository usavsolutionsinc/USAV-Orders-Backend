import { test, expect, type Route, type Page } from '@playwright/test';

/**
 * Mobile /m/identify — OCR local-pickup, NOT-IN-SYSTEM one-step actions (P2-AI-01).
 *
 * When the LAN vision box OCRs a product label but it resolves to NO catalog row
 * (`resolved: false`), the operator gets two ONE-STEP choices that never touch a
 * unit serial:
 *   (a) Create a SKU now  → POST /api/sku-catalog, then add the carton line.
 *   (b) Flag missing      → POST /api/sku-catalog/flag-missing (pending_skus queue).
 *
 * Acceptance:
 *   A. image → OCR → parsed text (covered by the live-identify spec; here the box
 *      returns raw_text and an unresolved candidate so the read surfaces).
 *   B. from the parsed read, create a SKU OR flag-missing in one step.
 *
 * Everything is mocked client-side (camera, LAN box, Vercel APIs) so the flow runs
 * without a real camera/box. Manual capture mode keeps the test deterministic.
 *
 * Run: npx playwright test identify-not-in-system.spec.ts --project=desktop
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

const VISION_ORIGIN = 'https://vision.test';
const MODEL = 'Bose SoundLink Flex';

/** Unresolved candidate — OCR read a real label but it's not in the catalog yet. */
const UNRESOLVED = {
  model: MODEL,
  zoho_item_id: null,
  sku: null,
  item_name: MODEL,
  sku_catalog_id: null,
  product_title: MODEL,
  image_url: null,
  resolved: false,
  via: 'code' as const,
};

function corsHeaders(origin: string) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}

/** Synthetic sharp/static camera so manual capture produces a real frame. */
function installFakeCamera(page: Page) {
  return page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    const paint = () => {
      for (let x = 0; x < canvas.width; x += 24) {
        ctx.fillStyle = (x / 24) % 2 === 0 ? '#000000' : '#ffffff';
        ctx.fillRect(x, 0, 24, canvas.height);
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
    // Default to manual capture mode (deterministic; no consensus loop).
    try { localStorage.setItem('usav.identify.scanMode', 'manual'); } catch { /* private mode */ }
  });
}

/** LAN box OCR → always reads the unresolved model with a plausible raw_text. */
function wireBox(page: Page, appOrigin: string) {
  return page.route(`${VISION_ORIGIN}/identify-label*`, async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders(appOrigin) });
    }
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', ...corsHeaders(appOrigin) },
      body: JSON.stringify({ model: MODEL, loose_model: MODEL, raw_text: `MODEL ${MODEL} SER. NO. 7788 BOSE CORP`, matched: true }),
    });
  });
}

/** Resolve route → returns the UNRESOLVED candidate (not in catalog). */
function wireResolveUnresolved(page: Page) {
  return page.route('**/api/receiving/identify-label', (route: Route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates: [UNRESOLVED] }),
    }),
  );
}

test.describe('Mobile /m/identify — not-in-system one-step actions (P2-AI-01)', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'fake camera (canvas.captureStream) requires Chromium');
  });

  test('Acceptance A+B(a): OCR read → Create SKU in one step', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page);
    await wireBox(page, appOrigin);
    await wireResolveUnresolved(page);

    let createReq: Record<string, unknown> | null = null;
    await page.route('**/api/sku-catalog', (route: Route) => {
      createReq = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, catalog: { id: 555 } }) });
    });
    const add = { count: 0 };
    await page.route('**/api/receiving/add-unmatched-line', (route: Route) => {
      add.count += 1;
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, line: { id: 901 } }) });
    });

    await page.goto('/m/identify?recvId=123&po=TEST');

    // Manual mode: tap the shutter to capture → OCR → unresolved candidate surfaces.
    await page.getByRole('button', { name: /Capture/i }).click();
    await expect(page.getByText(/Confirm the product/i)).toBeVisible({ timeout: 15_000 });
    // Acceptance A: the parsed OCR text is surfaced.
    await expect(page.getByText(/read:/i)).toBeVisible();
    await expect(page.getByText(/not in system/i)).toBeVisible();

    // Acceptance B(a): Create SKU → inline SKU field → Create + Add (one step).
    await page.getByRole('button', { name: /^Create SKU$/ }).click();
    await page.getByPlaceholder(/New SKU/i).fill('BOSE-FLEX-1');
    await page.getByRole('button', { name: /Create \+ Add/i }).click();

    await expect(page.getByText(/Added to PO TEST/i)).toBeVisible({ timeout: 10_000 });
    expect(createReq).toMatchObject({ sku: 'BOSE-FLEX-1', productTitle: MODEL });
    expect(add.count).toBe(1);
  });

  test('Acceptance B(b): OCR read → Flag missing in one step', async ({ page, baseURL }) => {
    const appOrigin = new URL(baseURL!).origin;
    await installFakeCamera(page);
    await wireBox(page, appOrigin);
    await wireResolveUnresolved(page);

    let flagReq: Record<string, unknown> | null = null;
    await page.route('**/api/sku-catalog/flag-missing', (route: Route) => {
      flagReq = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, pending: { id: 7, status: 'PENDING' } }) });
    });

    await page.goto('/m/identify?recvId=123&po=TEST');
    await page.getByRole('button', { name: /Capture/i }).click();
    await expect(page.getByText(/Confirm the product/i)).toBeVisible({ timeout: 15_000 });

    // Acceptance B(b): one tap flags the item into the pending_skus to-do queue.
    await page.getByRole('button', { name: /Flag missing/i }).click();
    await expect(page.getByText(/added to|this session|Next item/i).first()).toBeVisible({ timeout: 10_000 });
    expect(flagReq).toMatchObject({ suggestedTitle: MODEL, source: 'scan' });
  });
});
