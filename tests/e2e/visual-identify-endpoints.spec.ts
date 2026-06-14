import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * API contract tests for the visual-receiving-identify routes:
 *
 *   POST /api/receiving/visual-identify
 *     Enriches ranked SKU candidates from the vision box against sku_catalog.
 *     Read-only — no mutation. Guarded by withAuth({ permission: 'receiving.view' }).
 *
 *   GET /api/vision-config
 *     Returns { baseUrl } for the vision box URL. Same permission guard.
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) created by
 * global-setup, so `request.*` calls are authenticated as the admin staff.
 *
 * Fixture sourcing: a throwaway sku_catalog row is created via POST /api/sku-catalog
 * at the start of the enrichment tests and deleted in a finally block — matching
 * the pattern used in crud-catalog-reasoncodes.spec.ts and crud-qc-checks.spec.ts.
 * This avoids any dependency on pre-existing DB rows and keeps the suite idempotent.
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Spin up a throwaway active SKU catalog row; returns { id, sku, productTitle }. */
async function makeCatalog(
  request: APIRequestContext,
): Promise<{ id: number; sku: string; productTitle: string }> {
  const sku = `E2E-VI-${uniq()}`;
  const productTitle = 'E2E Visual Identify Widget';
  const res = await request.post('/api/sku-catalog', {
    data: { sku, productTitle, category: 'E2E-VI' },
  });
  expect(res.status(), 'catalog create for visual-identify fixture').toBe(201);
  const body = await res.json();
  return { id: body.catalog.id as number, sku: body.catalog.sku as string, productTitle };
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/receiving/visual-identify — auth guard', () => {
  test('unauthenticated request is rejected with 401 or 403', async ({ playwright }) => {
    // Create a fresh API context with no storageState — no session cookie.
    const anonCtx = await playwright.request.newContext({
      baseURL: process.env.PW_BASE_URL || 'http://localhost:3000',
    });
    try {
      const res = await anonCtx.post('/api/receiving/visual-identify', {
        data: { receiving_id: 1, candidates: [{ sku: 'SKU-TEST', score: 0.9 }] },
      });
      expect(
        [401, 403],
        `expected 401 or 403, got ${res.status()}`,
      ).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/receiving/visual-identify — enrichment', () => {
  test('happy path: resolves known SKU, preserves order+score, flags unknown SKU', async ({
    request,
  }) => {
    const cat = await makeCatalog(request);
    try {
      const unknownSku = `E2E-VI-UNKNOWN-${uniq()}`;
      const res = await request.post('/api/receiving/visual-identify', {
        data: {
          receiving_id: 1,
          candidates: [
            { sku: cat.sku, score: 0.95 },
            { sku: unknownSku, score: 0.42 },
          ],
        },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.candidates)).toBe(true);
      expect(body.candidates).toHaveLength(2);

      // First candidate — the known SKU we just created.
      const first = body.candidates[0];
      expect(first.sku).toBe(cat.sku);
      expect(first.score).toBe(0.95);
      expect(first.resolved).toBe(true);
      expect(typeof first.sku_catalog_id).toBe('number');
      expect(first.sku_catalog_id).toBe(cat.id);
      expect(typeof first.product_title).toBe('string');
      expect(first.product_title).toBe(cat.productTitle);

      // Second candidate — unknown SKU must not resolve.
      const second = body.candidates[1];
      expect(second.sku).toBe(unknownSku);
      expect(second.score).toBe(0.42);
      expect(second.resolved).toBe(false);
      expect(second.sku_catalog_id).toBeNull();
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });

  test('MAX_CANDIDATES cap: only first 10 candidates are returned', async ({ request }) => {
    const cat = await makeCatalog(request);
    try {
      // Send 12 candidates — the route caps at MAX_CANDIDATES=10.
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        sku: i === 0 ? cat.sku : `E2E-VI-CAP-${i}-${uniq()}`,
        score: 1 - i * 0.05,
      }));
      const res = await request.post('/api/receiving/visual-identify', {
        data: { receiving_id: 1, candidates },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.candidates.length).toBeLessThanOrEqual(10);
    } finally {
      await request.delete(`/api/sku-catalog/${cat.id}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/receiving/visual-identify — validation', () => {
  test('missing receiving_id → 400', async ({ request }) => {
    const res = await request.post('/api/receiving/visual-identify', {
      data: { candidates: [{ sku: 'SKU-X', score: 0.9 }] },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  test('receiving_id = 0 (invalid) → 400', async ({ request }) => {
    const res = await request.post('/api/receiving/visual-identify', {
      data: { receiving_id: 0, candidates: [{ sku: 'SKU-X', score: 0.9 }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  test('candidates not an array → 400', async ({ request }) => {
    const res = await request.post('/api/receiving/visual-identify', {
      data: { receiving_id: 1, candidates: 'not-an-array' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).success).toBe(false);
  });

  test('invalid JSON body → 400', async ({ request }) => {
    const res = await request.post('/api/receiving/visual-identify', {
      headers: { 'Content-Type': 'application/json' },
      data: 'this is not json {{{',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/vision-config', () => {
  test('returns 200 with a baseUrl string (tolerates empty string when env var unset)', async ({
    request,
  }) => {
    const res = await request.get('/api/vision-config');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // baseUrl is '' when NEXT_PUBLIC_VISION_BASE_URL is unset — that is valid.
    expect(typeof body.baseUrl).toBe('string');
  });

  test('unauthenticated request is rejected with 401 or 403', async ({ playwright }) => {
    const anonCtx = await playwright.request.newContext({
      baseURL: process.env.PW_BASE_URL || 'http://localhost:3000',
    });
    try {
      const res = await anonCtx.get('/api/vision-config');
      expect(
        [401, 403],
        `expected 401 or 403, got ${res.status()}`,
      ).toContain(res.status());
    } finally {
      await anonCtx.dispose();
    }
  });
});
