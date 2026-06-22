import { test, expect } from '@playwright/test';

/**
 * FBA shipment trace — API contract (P2-FBA-01, desktop project).
 *
 * Exercises GET /api/fba/shipments/[id]/trace, the audit read that resolves the
 * all-in-one shipment path:
 *   shipment → FNSKU line → serialized unit → unit path (inventory_events)
 * and the consistency flags it surfaces (acceptance B).
 *
 * Non-destructive: read-only. It picks a real shipment id from the shipped list
 * (or PW_TEST_FBA_SHIPMENT_ID) and asserts the trace contract shape. When no FBA
 * shipment exists in the test DB, it skips rather than fail.
 *
 * Env:
 *   PW_TEST_FBA_SHIPMENT_ID – optional integer id of an fba_shipments row.
 */

test.describe('FBA shipment trace', () => {
  test('GET /api/fba/shipments/[id]/trace returns shipment→FNSKU→unit path + flags', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    // Resolve a shipment id: env override, else the first shipped row.
    let shipmentId = Number(process.env.PW_TEST_FBA_SHIPMENT_ID || '0');
    if (!shipmentId) {
      const listRes = await request.get('/api/fba/shipments?status=SHIPPED&limit=1');
      expect(listRes.ok(), `shipments list failed with ${listRes.status()}`).toBeTruthy();
      const list = await listRes.json();
      shipmentId = Number(list?.shipments?.[0]?.id || 0);
    }
    test.skip(!shipmentId, 'No FBA shipment available in the test DB to trace.');

    const res = await request.get(`/api/fba/shipments/${shipmentId}/trace`);
    expect(res.ok(), `trace GET failed with ${res.status()}`).toBeTruthy();
    const body = await res.json();

    // Contract shape
    expect(body.success).toBe(true);
    expect(body.shipment).toBeTruthy();
    expect(body.shipment.id).toBe(shipmentId);
    expect(Array.isArray(body.items)).toBeTruthy();
    expect(body.summary).toBeTruthy();
    expect(typeof body.summary.unit_count).toBe('number');
    expect(typeof body.summary.traced_unit_count).toBe('number');
    expect(Array.isArray(body.flags)).toBeTruthy();

    // traced_unit_count never exceeds unit_count
    expect(body.summary.traced_unit_count).toBeLessThanOrEqual(body.summary.unit_count);

    // Each item carries the FNSKU and its (possibly empty) unit list.
    for (const item of body.items) {
      expect(typeof item.fnsku).toBe('string');
      expect(Array.isArray(item.units)).toBeTruthy();
      for (const unit of item.units) {
        expect(typeof unit.serial_unit_id).toBe('number');
        expect(Array.isArray(unit.timeline)).toBeTruthy();
        // A unit with zero events must carry a NO_PATH flag (acceptance B).
        if (unit.timeline.length === 0) {
          expect(unit.flags.some((f: any) => f.code === 'NO_PATH')).toBeTruthy();
        }
      }
    }

    // Every surfaced flag has a known code + severity.
    const KNOWN = new Set(['MISSING_UNIT_LINK', 'NO_PATH', 'CONDITION_MISMATCH', 'NO_TRACKING']);
    for (const f of body.flags) {
      expect(KNOWN.has(f.code)).toBeTruthy();
      expect(['warning', 'danger']).toContain(f.severity);
      expect(typeof f.scope).toBe('string');
    }
  });

  test('GET trace for a bogus shipment id is a clean 400/404', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');
    const res = await request.get('/api/fba/shipments/not-a-number/trace');
    expect([400, 404]).toContain(res.status());
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
