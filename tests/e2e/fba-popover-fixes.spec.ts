import { test, expect } from '@playwright/test';

/**
 * FBA popover fixes — API contract (P2-FBA-02, desktop project).
 *
 * Covers the three acceptance criteria of the popover-edit save paths:
 *   A. Tracking-number edits persist to fba_shipment_tracking via the
 *      shipments/[id]/tracking PATCH/POST endpoints and re-read consistently.
 *   B. FNSKU condition is read AND written against the same source of truth
 *      (fba_fnskus.condition) — the catalog GET/PATCH must echo condition.
 *   C. Re-reading after a write reflects the saved value (display consistency).
 *
 * Non-destructive design: the tracking flow is read-only here (it only asserts
 * the GET contract carries link_id + carrier so the save path can target the
 * right link). The condition round-trip writes to a throwaway test FNSKU and is
 * idempotent. When no FBA data exists, the relevant test skips.
 *
 * Env:
 *   PW_TEST_FBA_SHIPMENT_ID – optional integer id of an fba_shipments row.
 *   PW_TEST_FNSKU           – optional FNSKU to round-trip condition through.
 *                              Defaults to a clearly-synthetic test value.
 */

test.describe('FBA popover fixes', () => {
  // ── Acceptance A + C: tracking link contract ──────────────────────────────
  test('tracking GET exposes link_id + carrier so edits target the correct link', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    let shipmentId = Number(process.env.PW_TEST_FBA_SHIPMENT_ID || '0');
    if (!shipmentId) {
      const listRes = await request.get('/api/fba/shipments?status=SHIPPED&limit=1');
      expect(listRes.ok(), `shipments list failed with ${listRes.status()}`).toBeTruthy();
      const list = await listRes.json();
      shipmentId = Number(list?.shipments?.[0]?.id || 0);
    }
    test.skip(!shipmentId, 'No FBA shipment available in the test DB.');

    const res = await request.get(`/api/fba/shipments/${shipmentId}/tracking`);
    expect(res.ok(), `tracking GET failed with ${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.tracking)).toBeTruthy();

    // The save path keys off link_id + carrier. Every linked row must carry both
    // so the UPS-edit handler can PATCH the real UPS link (never a foreign carrier).
    for (const row of body.tracking) {
      expect(typeof row.link_id).toBe('number');
      expect(typeof row.tracking_id).toBe('number');
      expect(typeof row.carrier).toBe('string');
    }
  });

  // ── Acceptance B + C: condition read/write share one source of truth ──────
  test('FNSKU condition round-trips through fba_fnskus.condition', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    const fnsku = String(process.env.PW_TEST_FNSKU || 'X00PWTEST02').trim().toUpperCase();

    // Write condition via the catalog upsert (the QuickAdd popover's save path).
    const writeRes = await request.post('/api/fba/fnskus', {
      data: {
        fnsku,
        product_title: 'P2-FBA-02 condition round-trip',
        condition: 'B Used - Good',
      },
    });
    // Permission-gated environments may 401/403; skip rather than fail there.
    test.skip(writeRes.status() === 401 || writeRes.status() === 403, 'No FBA write permission in this env.');
    expect(writeRes.ok(), `fnsku upsert failed with ${writeRes.status()}`).toBeTruthy();
    const written = await writeRes.json();
    expect(written.success).toBe(true);
    // POST must echo the condition it persisted (was previously dropped).
    expect(written.fnsku?.condition).toBe('B Used - Good');

    // Re-read via the canonical single-FNSKU GET — must reflect the saved value.
    const readRes = await request.get(`/api/fba/fnskus/${encodeURIComponent(fnsku)}`);
    expect(readRes.ok(), `fnsku GET failed with ${readRes.status()}`).toBeTruthy();
    const read = await readRes.json();
    expect(read.success).toBe(true);
    expect(read.fnsku?.condition).toBe('B Used - Good');

    // Update via the PATCH endpoint — it must echo condition back (consistency fix).
    const patchRes = await request.patch(`/api/fba/fnskus/${encodeURIComponent(fnsku)}`, {
      data: { condition: 'A Used - Like New' },
    });
    expect(patchRes.ok(), `fnsku PATCH failed with ${patchRes.status()}`).toBeTruthy();
    const patched = await patchRes.json();
    expect(patched.success).toBe(true);
    expect(patched.fnsku?.condition).toBe('A Used - Like New');

    // Final re-read confirms the PATCH persisted to the same column the board reads.
    const finalRes = await request.get(`/api/fba/fnskus/${encodeURIComponent(fnsku)}`);
    const final = await finalRes.json();
    expect(final.fnsku?.condition).toBe('A Used - Like New');
  });
});
