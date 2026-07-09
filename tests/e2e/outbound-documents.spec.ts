import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Outbound documents — API contract + media library scope (desktop project).
 *
 * Exercises the canonical /api/orders/[id]/documents lifecycle (attach label,
 * list, duplicate conflict, delete), packing-slip fetch, and the outbound media
 * library union (`sourceScope=outbound`).
 *
 * Env:
 *   PW_TEST_ORDER_ID – integer id of an order row in the test DB (auto-resolved when unset)
 */

async function resolveTestOrderId(request: APIRequestContext): Promise<number | null> {
  const envRaw = process.env.PW_TEST_ORDER_ID?.trim();
  const candidates = [
    envRaw ? Number(envRaw) : NaN,
    6071,
    6070,
  ].filter((n) => Number.isFinite(n) && n > 0);

  for (const id of candidates) {
    const res = await request.get(`/api/orders/${id}`);
    if (res.ok()) return id;
  }

  const listRes = await request.get('/api/orders?limit=1&includeShipped=true');
  if (!listRes.ok()) return null;
  const json = await listRes.json();
  const first = Array.isArray(json.orders) ? json.orders[0] : null;
  const id = Number(first?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

test.describe('Outbound documents', () => {
  test('POST /api/orders/[id]/documents attaches, GET lists, re-attach is 409, DELETE unlinks', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    const ORDER_ID = await resolveTestOrderId(request);
    test.skip(ORDER_ID == null, 'No test order available — set PW_TEST_ORDER_ID');

    const cfgRes = await request.get(`/api/orders/${ORDER_ID}/documents`);
    expect(cfgRes.ok(), `config GET failed with ${cfgRes.status()}`).toBeTruthy();
    const cfg = await cfgRes.json();
    const base = String(cfg.nasBaseUrl || 'http://nas.e2e.local:8088').replace(/\/+$/, '');
    const labelUrl = `${base}/LABEL_e2e-doc__${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`;

    const postRes = await request.post(`/api/orders/${ORDER_ID}/documents`, {
      data: {
        documentType: 'shipping_label',
        url: labelUrl,
        carrier: 'USPS',
        tracking: '9400E2E-DOC',
      },
    });
    expect(postRes.ok(), `POST failed with ${postRes.status()}`).toBeTruthy();
    const body = await postRes.json();
    expect(body.success).toBe(true);
    expect(body.document.data.url).toBe(labelUrl);
    expect(body.document.documentType).toBe('shipping_label');
    const createdId: number = body.document.id;

    try {
      const getRes = await request.get(`/api/orders/${ORDER_ID}/documents`);
      expect(getRes.ok()).toBeTruthy();
      const { documents } = await getRes.json();
      expect(Array.isArray(documents)).toBe(true);
      const match = (documents as Array<{ id: number; data: { url: string } }>).find(
        (d) => d.id === createdId,
      );
      expect(match, 'Attached document not found in GET response').toBeDefined();

      const dupRes = await request.post(`/api/orders/${ORDER_ID}/documents`, {
        data: { documentType: 'shipping_label', url: labelUrl },
      });
      expect(dupRes.status(), 'duplicate attach should conflict').toBe(409);
    } finally {
      const delRes = await request.delete(`/api/documents/${createdId}`);
      expect(delRes.ok(), `cleanup DELETE failed with ${delRes.status()}`).toBeTruthy();
    }
  });

  test('POST /api/orders/[id]/documents/fetch can generate a packing slip', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    const ORDER_ID = await resolveTestOrderId(request);
    test.skip(ORDER_ID == null, 'No test order available — set PW_TEST_ORDER_ID');

    const fetchRes = await request.post(`/api/orders/${ORDER_ID}/documents/fetch`, {
      data: { types: ['packing_slip'] },
    });
    expect(fetchRes.ok(), `fetch failed with ${fetchRes.status()}`).toBeTruthy();
    const body = await fetchRes.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.fetched)).toBe(true);
    expect(Array.isArray(body.failed)).toBe(true);

    const slip = body.fetched.find(
      (d: { documentType: string }) => d.documentType === 'packing_slip',
    );
    if (slip) {
      expect(slip.id).toBeGreaterThan(0);
      expect(String(slip.data?.url || '')).toMatch(/^\/api\/documents\//);
      await request.delete(`/api/documents/${slip.id}`);
    }
  });

  test('GET /api/photos/library?sourceScope=outbound lists attached documents', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    const ORDER_ID = await resolveTestOrderId(request);
    test.skip(ORDER_ID == null, 'No test order available — set PW_TEST_ORDER_ID');

    const cfgRes = await request.get(`/api/orders/${ORDER_ID}/documents`);
    expect(cfgRes.ok()).toBeTruthy();
    const cfg = await cfgRes.json();
    const base = String(cfg.nasBaseUrl || 'http://nas.e2e.local:8088').replace(/\/+$/, '');
    const labelUrl = `${base}/LABEL_e2e-lib__${Date.now()}.pdf`;

    const postRes = await request.post(`/api/orders/${ORDER_ID}/documents`, {
      data: { documentType: 'shipping_label', url: labelUrl, tracking: '9400LIB' },
    });
    expect(postRes.ok()).toBeTruthy();
    const createdId: number = (await postRes.json()).document.id;

    try {
      const libRes = await request.get(
        `/api/photos/library?sourceScope=outbound&documentType=shipping_label&limit=48`,
      );
      expect(libRes.ok(), `library GET failed with ${libRes.status()}`).toBeTruthy();
      const lib = await libRes.json();
      expect(Array.isArray(lib.photos)).toBe(true);
      const match = (lib.photos as Array<{ id: number; kind: string }>).find(
        (item) => item.kind === 'document' && item.id === -createdId,
      );
      expect(match, 'Document tile not found in outbound library').toBeDefined();
    } finally {
      await request.delete(`/api/documents/${createdId}`);
    }
  });

  test('outbound deep link shows scope and document-type chips', async ({ page }) => {
    await page.goto('/ops/photos?sourceScope=outbound');
    await expect(page.getByText('Outbound').first()).toBeVisible();
    await expect(page.getByText('Document type')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shipping labels' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Packing slips' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pack photos' })).toBeVisible();
  });
});
