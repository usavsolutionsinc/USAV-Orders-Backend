import { test, expect } from '@playwright/test';

/**
 * Universal Incoming — eBay purchase → Incoming → Zoho PO link → single
 * deduped row.
 *
 * Plan: docs/incoming-universal-purchase-orders-plan.md §10 Phase 6 (last
 * checkbox: "E2E: eBay purchase → Incoming → Zoho PO created → single deduped
 * row") / §4.2 (the dedup invariant) / §6 + §8.3 (the `incoming_universal` flag).
 *
 * API-level test using the authenticated `request` fixture — the session
 * cookie comes from tests/.auth/admin.json (global-setup signs in as an
 * admin, whose role carries ALL_PERMISSIONS, covering both `integrations.ebay`
 * (import-ebay) and `receiving.mark_received` (link + the raw decoy-row
 * POST/DELETE used to seed/clean up this test)).
 *
 * Covers the identity chain end to end:
 *   1. POST /api/receiving/inbound/import-ebay lands ONE eBay buyer purchase
 *      onto the Incoming spine — ONE receiving_lines row
 *      (inbound_source_type='ebay') + a PRIMARY inbound_purchase_order_links row.
 *   2. GET /api/receiving-lines?view=incoming&inbound=ebay surfaces that row.
 *   3. A DECOY Zoho-only spine row is seeded for the SAME real-world PO — this
 *      simulates the ordinary case where Zoho's own PO sync
 *      (/api/cron/zoho/incoming-po-sync) independently created a spine row for
 *      the order before the operator manually links the eBay side to it. This
 *      is the exact duplication the dedup invariant guards against; without
 *      seeding it, "only one row exists" would be trivially true rather than
 *      an assertion that the merge actually collapsed a duplicate.
 *   4. POST /api/receiving/inbound/link attaches the Zoho PO to the eBay row.
 *      Per manual-link.ts's `augment_winner` default (the route's default
 *      merge_strategy), the decoy Zoho-only row is collapsed (deleted) because
 *      the pairing is unambiguous — the eBay row becomes the sole winner, now
 *      carrying an eBay PRIMARY link + a Zoho SECONDARY link.
 *   5. Assert the dedup invariant: exactly ONE Incoming row remains for the
 *      order (the winner, zoho_purchaseorder_id now set); the decoy id 404s.
 *
 * REQUIRES the `incoming_universal` feature flag ON for the test org — either
 * INCOMING_UNIVERSAL=true globally, or an organization_feature_flags row for
 * this org (see src/lib/feature-flags.ts `isIncomingUniversal`). With the flag
 * OFF, `view=incoming` stays on the legacy Zoho-only path (no eBay rows, no
 * `?inbound=` facet — see the `universalIncoming` branch in
 * src/app/api/receiving-lines/route.ts) and this spec's assertions will fail
 * for reasons unrelated to the dedup logic itself. This spec is therefore a
 * deliberate opt-in, mirroring the E2E_PHOTOS_GCS gate in
 * tests/e2e/photos-gcs-upload.spec.ts:
 *
 *   E2E_INCOMING_UNIVERSAL=1 npx playwright test tests/e2e/incoming-ebay-zoho-dedup.spec.ts
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe('Universal Incoming — eBay purchase → Zoho PO dedup', () => {
  test.skip(
    !process.env.E2E_INCOMING_UNIVERSAL,
    'Set E2E_INCOMING_UNIVERSAL=1 once the target org has the `incoming_universal` ' +
      'feature flag ON (see src/lib/feature-flags.ts isIncomingUniversal). Off, ' +
      '`view=incoming` never surfaces eBay-sourced rows.',
  );

  test('eBay purchase lands on Incoming, links to a Zoho PO, and dedupes to one row', async ({ request }) => {
    const orderId = `E2E-EBAY-${uniq()}`;
    const sku = `E2E-SKU-${uniq()}`;
    const itemName = 'E2E Universal Incoming Widget';

    // Synthetic Zoho identifiers. manual-link.ts (linkInboundManually) does NOT
    // validate the target against zoho_po_mirror or a live Zoho call, so a
    // synthetic id still exercises the full link + augment_winner merge
    // chokepoint end to end. Provide PW_ZOHO_PO_ID / PW_ZOHO_PO_NUMBER (a real
    // Zoho Inventory purchaseorder_id / purchaseorder_number) to additionally
    // cross-check against a live-synced Zoho PO in your test org.
    const zohoPoId = process.env.PW_ZOHO_PO_ID || `E2E-ZOHOPO-${uniq()}`;
    const zohoPoNumber = process.env.PW_ZOHO_PO_NUMBER || `PO-E2E-${uniq()}`;

    let ebayLineId: number | undefined;
    let decoyLineId: number | undefined;

    try {
      // ── 1. Import the eBay buyer purchase onto the Incoming spine ──────────
      const importRes = await request.post('/api/receiving/inbound/import-ebay', {
        data: {
          order_id: orderId,
          sku,
          item_name: itemName,
          quantity: 1,
        },
      });
      expect(importRes.status(), await importRes.text()).toBeLessThan(300);
      const imported = await importRes.json();
      expect(imported.success).toBe(true);
      expect(imported.created).toBe(true);
      ebayLineId = imported.receiving_line_id;
      expect(typeof ebayLineId).toBe('number');

      // ── 2. Verify it appears in Incoming as the eBay-primary source ────────
      const incomingRes = await request.get('/api/receiving-lines?view=incoming&inbound=ebay&limit=200');
      expect(incomingRes.status()).toBe(200);
      const incomingBody = await incomingRes.json();
      expect(incomingBody.success).toBe(true);
      const incomingRows: any[] = incomingBody.receiving_lines ?? incomingBody.rows ?? [];
      const ebayRow = incomingRows.find((r) => r.id === ebayLineId);
      expect(ebayRow, 'imported eBay line is visible under view=incoming&inbound=ebay').toBeTruthy();
      expect(ebayRow.inbound_source_type).toBe('ebay');
      expect(ebayRow.source_order_id).toBe(orderId);
      expect(ebayRow.zoho_purchaseorder_id).toBeNull();

      // ── 3. Seed a DECOY Zoho-only spine row for the SAME real-world PO ─────
      // Simulates Zoho's own incoming-po-sync cron already having created a
      // spine row for this PO before the operator links the eBay side to it —
      // the exact duplicate the dedup invariant (step 5) guards against.
      const decoyRes = await request.post('/api/receiving-lines', {
        data: {
          zoho_item_id: `E2E-ZOHO-ITEM-${uniq()}`,
          zoho_purchaseorder_id: zohoPoId,
          item_name: itemName,
          sku,
          quantity_expected: 1,
        },
      });
      expect(decoyRes.status()).toBe(201);
      const decoy = await decoyRes.json();
      expect(decoy.success).toBe(true);
      decoyLineId = decoy.receiving_line.id;
      expect(decoyLineId).not.toBe(ebayLineId);

      // ── 4. Manually link the eBay row to the Zoho PO ───────────────────────
      const linkRes = await request.post('/api/receiving/inbound/link', {
        data: {
          receiving_line_id: ebayLineId,
          target: {
            system: 'zoho',
            purchase_order_id: zohoPoId,
            purchase_order_number: zohoPoNumber,
          },
        },
      });
      expect(linkRes.status(), await linkRes.text()).toBe(200);
      const linked = await linkRes.json();
      expect(linked).toMatchObject({
        success: true,
        winner_line_id: ebayLineId,
        source_order_id: zohoPoId,
        zoho_purchaseorder_id: zohoPoId,
      });
      // The decoy was the sole, unambiguous Zoho-only duplicate → collapsed
      // (manual-link.ts step 6, `augment_winner`'s default merge behavior).
      expect(linked.merged).toBe(true);

      // ── 5. Dedup invariant: ONE row remains, carrying BOTH links ───────────
      // The decoy Zoho-only spine row no longer exists …
      const decoyAfter = await request.get(`/api/receiving-lines?id=${decoyLineId}`);
      expect(decoyAfter.status()).toBe(404);
      decoyLineId = undefined; // already gone — nothing left to clean up

      // … the winner now carries the Zoho PO id while still reading as the
      // eBay-primary line (the eBay link stays primary; Zoho was added as
      // secondary — see manual-link.ts step 3/"targetIsPrimary" logic) …
      const winnerAfter = await request.get(`/api/receiving-lines?id=${ebayLineId}`);
      expect(winnerAfter.status()).toBe(200);
      const winnerBody = await winnerAfter.json();
      expect(winnerBody.receiving_line).toMatchObject({
        id: ebayLineId,
        inbound_source_type: 'ebay',
        source_order_id: orderId,
        zoho_purchaseorder_id: zohoPoId,
      });

      // … and Incoming shows exactly ONE row for this order/PO — never two.
      const finalIncoming = await request.get('/api/receiving-lines?view=incoming&inbound=ebay&limit=200');
      expect(finalIncoming.status()).toBe(200);
      const finalRows: any[] = (await finalIncoming.json()).receiving_lines ?? [];
      const matches = finalRows.filter(
        (r) => r.id === ebayLineId || r.id === decoy.receiving_line.id,
      );
      expect(matches.length).toBe(1);
      expect(matches[0].zoho_purchaseorder_id).toBe(zohoPoId);
    } finally {
      // Idempotent cleanup — leaves no residue even on assertion failure.
      if (ebayLineId) await request.delete(`/api/receiving-lines?id=${ebayLineId}`);
      if (decoyLineId) await request.delete(`/api/receiving-lines?id=${decoyLineId}`);
    }
  });
});
