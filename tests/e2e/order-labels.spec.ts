import { test, expect } from '@playwright/test';

/**
 * Order shipping-labels — API contract CRUD (desktop project).
 *
 * Exercises the full /api/order-labels lifecycle the NAS label drop-zone relies
 * on: attach a NAS-style label URL (no byte upload — the browser PUTs the file
 * straight to the NAS over WebDAV; see deploy/nas-photo-server/Caddyfile.local
 * for the local test server), confirm it's returned by the list, that a repeat
 * attach conflicts (idempotent re-drop), and that delete unlinks it.
 *
 * The label URL is built under the org's configured NAS base when present (so the
 * allowlist passes); otherwise a placeholder is used (the route stays permissive
 * when no NAS base is configured).
 *
 * Env:
 *   PW_TEST_ORDER_ID – integer id of an order row in the test DB (default 1)
 */

const ORDER_ID = Number(process.env.PW_TEST_ORDER_ID || '1');

test.describe('Order shipping labels', () => {
  test('POST /api/order-labels attaches, GET lists, re-attach is 409, DELETE unlinks', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    // Read the config to build an allowlisted URL (falls back to a placeholder
    // that works while the route is permissive / NAS base unset).
    const cfgRes = await request.get(`/api/order-labels?orderId=${ORDER_ID}`);
    expect(cfgRes.ok(), `config GET failed with ${cfgRes.status()}`).toBeTruthy();
    const cfg = await cfgRes.json();
    const base = String(cfg.nasBaseUrl || 'http://nas.e2e.local:8088').replace(/\/+$/, '');
    const labelUrl = `${base}/LABEL_e2e__${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`;

    // 1) Attach by URL (the NAS path — no byte upload).
    const postRes = await request.post('/api/order-labels', {
      data: { orderId: ORDER_ID, labelUrl, carrier: 'USPS', tracking: '9400E2E' },
    });
    expect(postRes.ok(), `POST failed with ${postRes.status()}`).toBeTruthy();
    const body = await postRes.json();
    expect(body.success).toBe(true);
    expect(body.label.url).toBe(labelUrl);
    expect(body.label.orderId).toBe(ORDER_ID);
    const createdId: number = body.label.id;

    try {
      // 2) GET the order's labels; ours must be present.
      const getRes = await request.get(`/api/order-labels?orderId=${ORDER_ID}`);
      expect(getRes.ok()).toBeTruthy();
      const { labels } = await getRes.json();
      expect(Array.isArray(labels)).toBe(true);
      const match = (labels as Array<{ url: string }>).find((l) => l.url === labelUrl);
      expect(match, 'Attached label URL not found in GET response').toBeDefined();

      // 3) Re-attaching the same URL conflicts (idempotent re-drop, no dup row).
      const dupRes = await request.post('/api/order-labels', {
        data: { orderId: ORDER_ID, labelUrl },
      });
      expect(dupRes.status(), 'duplicate attach should conflict').toBe(409);
    } finally {
      // 4) Clean up so the test is self-contained.
      const delRes = await request.delete(`/api/order-labels?id=${createdId}`);
      expect(delRes.ok(), `cleanup DELETE failed with ${delRes.status()}`).toBeTruthy();
    }
  });
});
