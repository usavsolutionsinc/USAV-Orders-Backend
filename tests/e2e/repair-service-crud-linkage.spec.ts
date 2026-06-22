import { test, expect } from '@playwright/test';

/**
 * P2-RPR-02 — repair_service ticket CRUD + linkage/unlinkage + manual entry.
 *
 * Exercises the additive surface built for this task against the live API:
 *   A. create (POST /api/repair-service) → read (GET /api/repair-service/[id])
 *      → update (PATCH /api/repair-service) → soft-delete (DELETE .../[id])
 *      → reopen (POST .../[id]/reopen)
 *   B. link (POST .../[id]/link) → unlink (DELETE .../[id]/link)
 *   C. manual repair-service entry + manual pairing at create persist
 *   D. recent feed (GET /api/repair-service?tab=active) returns the new ticket
 *
 * Authenticated via tests/.auth/admin.json (global-setup). Uses the `request`
 * fixture. DON'T run live in CI without seed-data cleanup — every created
 * ticket is soft-cancelled at the end so the queue stays clean.
 */

test.describe('repair-service ticket CRUD + linkage', () => {
  test('create → read → link → unlink → update → soft-delete → reopen', async ({ request }) => {
    // A. CREATE (manual entry) — also carries manual pairing on intake (C).
    const createRes = await request.post('/api/repair-service', {
      data: {
        productTitle: 'E2E Bose QC35 — repair ticket',
        contactInfo: 'E2E Tester, 7145556888, e2e@example.com',
        price: '130.00',
        issue: 'No audio on left cup',
        serialNumber: 'E2E-SER-0001',
        sourceOrderId: 'E2E-ORDER-9001',
      },
    });
    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.success).toBe(true);
    const id = created.repair.id as number;
    expect(created.repair.source_system).toBe('manual');
    expect(created.repair.source_order_id).toBe('E2E-ORDER-9001');

    // A. READ
    const getRes = await request.get(`/api/repair-service/${id}`);
    expect(getRes.status()).toBe(200);
    expect((await getRes.json()).id).toBe(id);

    // D. RECENT FEED — newly created ticket appears in the active tab.
    const feedRes = await request.get('/api/repair-service?tab=active&limit=100');
    expect(feedRes.status()).toBe(200);
    const feed = await feedRes.json();
    const rows = feed.rows || feed.repairs || [];
    expect(rows.some((r: { id: number }) => r.id === id)).toBe(true);

    // B. LINK (manual pairing) — set tracking + serial + SKU.
    const linkRes = await request.post(`/api/repair-service/${id}/link`, {
      data: {
        source_tracking_number: 'E2E-TRACK-12345',
        serial_number: 'E2E-SER-0002',
        source_sku: 'E2E-SKU-RS',
      },
    });
    expect(linkRes.status()).toBe(200);
    const linked = await linkRes.json();
    expect(linked.repair.source_tracking_number).toBe('E2E-TRACK-12345');
    expect(linked.repair.serial_number).toBe('E2E-SER-0002');
    expect(linked.repair.source_sku).toBe('E2E-SKU-RS');
    // The order id set at create is untouched by this partial link.
    expect(linked.repair.source_order_id).toBe('E2E-ORDER-9001');

    // B. UNLINK subset — clear only the tracking number; serial/sku remain.
    const unlinkOneRes = await request.delete(
      `/api/repair-service/${id}/link?fields=source_tracking_number`,
    );
    expect(unlinkOneRes.status()).toBe(200);
    const unlinkedOne = await unlinkOneRes.json();
    expect(unlinkedOne.repair.source_tracking_number == null || unlinkedOne.repair.source_tracking_number === '').toBeTruthy();
    expect(unlinkedOne.repair.serial_number).toBe('E2E-SER-0002');

    // B. UNLINK ALL — full clear (reversible: ticket row survives).
    const unlinkAllRes = await request.delete(`/api/repair-service/${id}/link`);
    expect(unlinkAllRes.status()).toBe(200);
    const unlinkedAll = await unlinkAllRes.json();
    expect(unlinkedAll.repair.source_order_id == null || unlinkedAll.repair.source_order_id === '').toBeTruthy();
    expect(unlinkedAll.repair.source_sku == null || unlinkedAll.repair.source_sku === '').toBeTruthy();

    // A. UPDATE — status + notes via the shared PATCH handler.
    const patchRes = await request.patch('/api/repair-service', {
      data: { id, status: 'Awaiting Parts', notes: 'e2e — waiting on driver' },
    });
    expect(patchRes.status()).toBe(200);
    const afterPatch = await request.get(`/api/repair-service/${id}`);
    expect((await afterPatch.json()).status).toBe('Awaiting Parts');

    // A. SOFT-DELETE — status → Cancelled, row preserved for audit.
    const delRes = await request.delete(`/api/repair-service/${id}?reason=e2e+cleanup`);
    expect(delRes.status()).toBe(200);
    expect((await delRes.json()).repair.status).toBe('Cancelled');

    // A. REOPEN — reverse of soft-delete; restores the prior status.
    const reopenRes = await request.post(`/api/repair-service/${id}/reopen`);
    expect(reopenRes.status()).toBe(200);
    expect((await reopenRes.json()).repair.status).toBe('Awaiting Parts');

    // Final cleanup — re-cancel so the e2e ticket leaves the active queue.
    await request.delete(`/api/repair-service/${id}?reason=e2e+final+cleanup`);
  });

  test('create rejects a blank product title', async ({ request }) => {
    const res = await request.post('/api/repair-service', { data: { productTitle: '' } });
    expect(res.status()).toBe(400);
  });

  test('link requires at least one field', async ({ request }) => {
    // Create a throwaway ticket, attempt an empty link, then clean up.
    const created = await request.post('/api/repair-service', {
      data: { productTitle: 'E2E empty-link probe' },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).repair.id as number;

    const res = await request.post(`/api/repair-service/${id}/link`, { data: {} });
    expect(res.status()).toBe(400);

    await request.delete(`/api/repair-service/${id}?reason=e2e+cleanup`);
  });
});
