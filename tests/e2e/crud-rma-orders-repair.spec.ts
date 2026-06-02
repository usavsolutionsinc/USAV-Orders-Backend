import { test, expect } from '@playwright/test';

/**
 * CRUD coverage for record routes that touch live domain data:
 *   - /api/rma/[id]            — flag-gated by INVENTORY_V2_RMA (describe skips on 503)
 *   - /api/orders/[id]         — needs an existing order: set PW_TEST_ORDER_ID
 *   - /api/repair-service/[id] — needs an active repair:  set PW_TEST_REPAIR_ID
 *
 * Authenticated via tests/.auth/admin.json (global-setup). Uses the `request`
 * fixture. Gated tests `test.skip` when their precondition isn't available so
 * the suite stays green in environments without the flag or seed data.
 */

test.describe('rma CRUD (INVENTORY_V2_RMA)', () => {
  test('create → read → update → soft-cancel', async ({ request }) => {
    // Probe the flag with the real create call.
    const createRes = await request.post('/api/rma', {
      data: { direction: 'INBOUND_FROM_CUSTOMER' },
    });
    test.skip(createRes.status() === 503, 'INVENTORY_V2_RMA flag is off');

    expect(createRes.status()).toBe(201);
    const created = await createRes.json();
    expect(created.ok).toBe(true);
    expect(created.rma?.status).toBe('AUTHORIZED');
    const id = created.rma.id;

    const getRes = await request.get(`/api/rma/${id}`);
    expect(getRes.status()).toBe(200);
    expect((await getRes.json()).rma?.id).toBe(id);

    const patchRes = await request.patch(`/api/rma/${id}`, {
      data: { expected_carrier: 'UPS', notes: 'e2e note' },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).rma?.expectedCarrier).toBe('UPS');

    // DELETE = soft-cancel (only AUTHORIZED can cancel).
    const delRes = await request.delete(`/api/rma/${id}`);
    expect(delRes.status()).toBe(200);
    expect((await delRes.json()).rma?.status).toBe('CANCELED');
  });

  test('unknown id → 404', async ({ request }) => {
    const probe = await request.post('/api/rma', { data: { direction: 'INBOUND_FROM_CUSTOMER' } });
    test.skip(probe.status() === 503, 'INVENTORY_V2_RMA flag is off');
    // Tidy up the probe row so it doesn't linger as an open RMA.
    if (probe.status() === 201) {
      const pid = (await probe.json()).rma?.id;
      if (pid) await request.delete(`/api/rma/${pid}`);
    }

    const res = await request.get('/api/rma/999999999');
    expect(res.status()).toBe(404);
  });
});

test.describe('orders record route', () => {
  const orderId = process.env.PW_TEST_ORDER_ID;

  test('read + patch (restore) + step-up-guarded delete', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');

    const getRes = await request.get(`/api/orders/${orderId}`);
    expect(getRes.status()).toBe(200);
    const order = (await getRes.json()).order;
    expect(order?.id).toBe(Number(orderId));
    const originalNotes = order?.notes ?? null;

    const stamp = `e2e ${Date.now()}`;
    const patchRes = await request.patch(`/api/orders/${orderId}`, { data: { notes: stamp } });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).order?.notes).toBe(stamp);

    // Restore the original notes (best-effort cleanup).
    await request.patch(`/api/orders/${orderId}`, { data: { notes: originalNotes } });

    // DELETE is gated by orders.void, a step-up permission. Without a fresh
    // step-up grant the destructive path must be blocked — this asserts the
    // protection holds (the order is NOT deleted).
    const delRes = await request.delete(`/api/orders/${orderId}`);
    expect(delRes.status()).toBe(403);
    expect((await delRes.json()).error).toBe('STEPUP_REQUIRED');
  });

  test('unknown id → 404', async ({ request }) => {
    const res = await request.get('/api/orders/999999999');
    expect(res.status()).toBe(404);
  });
});

test.describe('orders tracking sub-resource', () => {
  const orderId = process.env.PW_TEST_ORDER_ID;

  test('set → edit → delete primary tracking', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');

    // Capture the original tracking so we can best-effort restore at the end.
    const before = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    const originalTracking: string | null = before?.shipping_tracking_number ?? null;

    // SET primary tracking → reflected on the order read.
    const t1 = `1ZE2E${Date.now()}`;
    const setRes = await request.patch(`/api/orders/${orderId}/tracking`, {
      data: { primaryTrackingNumber: t1 },
    });
    expect(setRes.status()).toBe(200);
    const afterSet = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterSet?.shipping_tracking_number).toBe(t1);
    const shipmentId = Number(afterSet?.shipment_id);
    expect(Number.isFinite(shipmentId) && shipmentId > 0).toBe(true);

    // EDIT primary tracking to a new value.
    const t2 = `1ZE2E${Date.now()}X`;
    const editRes = await request.patch(`/api/orders/${orderId}/tracking`, {
      data: { primaryTrackingNumber: t2 },
    });
    expect(editRes.status()).toBe(200);
    const afterEdit = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterEdit?.shipping_tracking_number).toBe(t2);

    // DELETE unlinks the shipment from the order (?shipment_id=).
    const editedShipmentId = Number(afterEdit?.shipment_id) || shipmentId;
    const delRes = await request.delete(`/api/orders/${orderId}/tracking?shipment_id=${editedShipmentId}`);
    expect(delRes.status()).toBe(200);
    const afterDel = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterDel?.shipping_tracking_number ?? null).toBeNull();

    // Best-effort restore of the original primary tracking.
    if (originalTracking) {
      await request.patch(`/api/orders/${orderId}/tracking`, {
        data: { primaryTrackingNumber: originalTracking },
      });
    }
  });

  test('empty body → 400', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');
    const res = await request.patch(`/api/orders/${orderId}/tracking`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('delete without shipment_id → 400', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');
    const res = await request.delete(`/api/orders/${orderId}/tracking`);
    expect(res.status()).toBe(400);
  });

  test('unknown order id → 404', async ({ request }) => {
    const res = await request.patch('/api/orders/999999999/tracking', {
      data: { primaryTrackingNumber: '1ZNOPE' },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('repair-service soft-cancel', () => {
  const repairId = process.env.PW_TEST_REPAIR_ID;

  test('cancel hides the repair from the active tab', async ({ request }) => {
    test.skip(!repairId, 'set PW_TEST_REPAIR_ID to an active (non-terminal) repair id');

    const delRes = await request.delete(`/api/repair-service/${repairId}`);
    expect(delRes.status()).toBe(200);
    const body = await delRes.json();
    expect(body.success).toBe(true);
    expect(body.repair?.status).toBe('Cancelled');

    const listRes = await request.get('/api/repair-service?tab=active');
    const list = await listRes.json();
    const rows = list.rows ?? list.repairs ?? [];
    expect(rows.some((r: any) => r.id === Number(repairId))).toBe(false);
  });

  test('invalid id → 400, unknown id → 404', async ({ request }) => {
    const bad = await request.delete('/api/repair-service/not-a-number');
    expect(bad.status()).toBe(400);

    const missing = await request.delete('/api/repair-service/999999999');
    expect(missing.status()).toBe(404);
  });
});

test.describe('orders tracking sub-resource', () => {
  const orderId = process.env.PW_TEST_ORDER_ID;

  test('set → edit → delete primary tracking', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');

    // Capture the original tracking so we can best-effort restore at the end.
    const before = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    const originalTracking: string | null = before?.shipping_tracking_number ?? null;

    // SET primary tracking → reflected on the order read.
    const t1 = `1ZE2E${Date.now()}`;
    const setRes = await request.patch(`/api/orders/${orderId}/tracking`, {
      data: { primaryTrackingNumber: t1 },
    });
    expect(setRes.status()).toBe(200);
    const afterSet = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterSet?.shipping_tracking_number).toBe(t1);
    const shipmentId = Number(afterSet?.shipment_id);
    expect(Number.isFinite(shipmentId) && shipmentId > 0).toBe(true);

    // EDIT primary tracking to a new value.
    const t2 = `1ZE2E${Date.now()}X`;
    const editRes = await request.patch(`/api/orders/${orderId}/tracking`, {
      data: { primaryTrackingNumber: t2 },
    });
    expect(editRes.status()).toBe(200);
    const afterEdit = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterEdit?.shipping_tracking_number).toBe(t2);

    // DELETE unlinks the shipment from the order (?shipment_id=).
    const editedShipmentId = Number(afterEdit?.shipment_id) || shipmentId;
    const delRes = await request.delete(`/api/orders/${orderId}/tracking?shipment_id=${editedShipmentId}`);
    expect(delRes.status()).toBe(200);
    const afterDel = (await (await request.get(`/api/orders/${orderId}`)).json()).order;
    expect(afterDel?.shipping_tracking_number ?? null).toBeNull();

    // Best-effort restore of the original primary tracking.
    if (originalTracking) {
      await request.patch(`/api/orders/${orderId}/tracking`, {
        data: { primaryTrackingNumber: originalTracking },
      });
    }
  });

  test('empty body → 400', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');
    const res = await request.patch(`/api/orders/${orderId}/tracking`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('delete without shipment_id → 400', async ({ request }) => {
    test.skip(!orderId, 'set PW_TEST_ORDER_ID to an existing order id');
    const res = await request.delete(`/api/orders/${orderId}/tracking`);
    expect(res.status()).toBe(400);
  });

  test('unknown order id → 404', async ({ request }) => {
    const res = await request.patch('/api/orders/999999999/tracking', {
      data: { primaryTrackingNumber: '1ZNOPE' },
    });
    expect(res.status()).toBe(404);
  });
});
