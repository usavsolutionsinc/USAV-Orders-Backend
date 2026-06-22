import { test, expect } from '@playwright/test';
import {
  packScanReducer,
  classifyPackScan,
  INITIAL_PACK_SCAN_STATE,
  type PackScanState,
} from '../../src/lib/packer/pack-scan-machine';

/**
 * P1-MOB-01 — Mobile packer flow with scan-driven auto-progression.
 *
 * Two coverage layers:
 *   1. PURE state-machine + classifier tests (deterministic, no app server):
 *      these ARE acceptance A — "scan 1 → order details, scan 2 → what to pack".
 *   2. A mobile-project smoke that the /m/pack Pack mode renders the scan
 *      surface + step rail legibly on an iPhone 14 viewport (acceptance B/C).
 *
 * The pack flow is read-only (resolveTestingScan with forcedType:'sku' never
 * mints/mutates a serial), so the smoke is non-destructive. The live two-scan
 * resolve needs seeded order + pre-packed SKU data, so that part is asserted at
 * the machine level here and left to manual/device verification end-to-end.
 */

test.describe('P1-MOB-01 · pack scan state machine (acceptance A)', () => {
  test('scan 1 (order) → ORDER_DETAILS, scan 2 (product) → WHAT_TO_PACK', () => {
    let s: PackScanState = INITIAL_PACK_SCAN_STATE;
    expect(s.name).toBe('idle');

    // Scan 1 — an order/tracking identity anchors the flow.
    s = packScanReducer(s, { type: 'SCAN', raw: 'ORDER-1234', kind: 'order' });
    expect(s.name).toBe('order_details');
    expect(s.context.orderRef).toBe('ORDER-1234');
    expect(s.context.productRef).toBeNull();

    // Scan 2 — a product/SKU label advances to "what to pack".
    s = packScanReducer(s, { type: 'SCAN', raw: 'SKU-00098', kind: 'product' });
    expect(s.name).toBe('what_to_pack');
    expect(s.context.orderRef).toBe('ORDER-1234');
    expect(s.context.productRef).toBe('SKU-00098');
  });

  test('a product scan with no order anchored is ignored (cannot skip step 1)', () => {
    const s = packScanReducer(INITIAL_PACK_SCAN_STATE, {
      type: 'SCAN',
      raw: 'SKU-00098',
      kind: 'product',
    });
    expect(s.name).toBe('idle');
    expect(s.context.productRef).toBeNull();
  });

  test('a new order scan re-anchors and clears the prior product', () => {
    let s: PackScanState = INITIAL_PACK_SCAN_STATE;
    s = packScanReducer(s, { type: 'SCAN', raw: 'ORDER-A', kind: 'order' });
    s = packScanReducer(s, { type: 'SCAN', raw: 'SKU-1', kind: 'product' });
    expect(s.name).toBe('what_to_pack');

    s = packScanReducer(s, { type: 'SCAN', raw: 'ORDER-B', kind: 'order' });
    expect(s.name).toBe('order_details');
    expect(s.context.orderRef).toBe('ORDER-B');
    expect(s.context.productRef).toBeNull();
  });

  test('BACK steps from product → order, then order → idle', () => {
    let s: PackScanState = INITIAL_PACK_SCAN_STATE;
    s = packScanReducer(s, { type: 'SCAN', raw: 'ORDER-A', kind: 'order' });
    s = packScanReducer(s, { type: 'SCAN', raw: 'SKU-1', kind: 'product' });

    s = packScanReducer(s, { type: 'BACK' });
    expect(s.name).toBe('order_details');
    expect(s.context.productRef).toBeNull();

    s = packScanReducer(s, { type: 'BACK' });
    expect(s.name).toBe('idle');
  });

  test('classifier: tracking/serial/SKU map to order vs product', () => {
    // A carrier tracking number is order-level (first scan, packing slip).
    expect(classifyPackScan('1ZA8337B0325514010', 'idle')).toBe('order');
    // A printed unit-id is always a product.
    expect(classifyPackScan('00098-2621-000142', 'order_details')).toBe('product');
    // An R- carton handle is a product (receiving code).
    expect(classifyPackScan('R-123', 'order_details')).toBe('product');
    // Ambiguous plain token: order before anchoring, product after.
    expect(classifyPackScan('PLAIN123', 'idle')).toBe('order');
    expect(classifyPackScan('PLAIN123', 'order_details')).toBe('product');
    // Empty → unknown.
    expect(classifyPackScan('', 'idle')).toBe('unknown');
  });
});

test.describe('P1-MOB-01 · /m/pack mobile surface (acceptance B/C)', () => {
  test('Pack mode renders the scan surface + two-step rail on iPhone 14', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only');

    await page.goto('/m/pack');

    // The two-mode slider (Pack · Recent) and the Pack view's step rail.
    await expect(page.getByRole('tab', { name: /pack/i }).first()).toBeVisible();
    await expect(page.getByText(/1 · order/i)).toBeVisible();
    await expect(page.getByText(/2 · pack/i)).toBeVisible();

    // The canonical scan input (manual entry + QR camera toggle) is present.
    await expect(page.getByPlaceholder(/scan order/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /scan with camera|open camera scanner/i }),
    ).toBeVisible();
  });
});
