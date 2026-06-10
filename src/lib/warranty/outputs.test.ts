import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './reports';
import { computeQuoteTotals } from './quotes';
import { buildEbayRefurbDraft, EBAY_SELLER_REFURBISHED_CONDITION_ID } from './ebay-draft';
import type { WarrantyClaimDetail } from './types';

// ── toCsv ────────────────────────────────────────────────────────────────────

test('toCsv emits header + rows with CRLF', () => {
  const csv = toCsv(
    [{ a: '1', b: 'x' }, { a: '2', b: 'y' }],
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
  );
  assert.equal(csv, 'A,B\r\n1,x\r\n2,y');
});

test('toCsv quotes + escapes cells with comma / quote / newline', () => {
  const csv = toCsv(
    [{ v: 'a,b' }, { v: 'he said "hi"' }, { v: 'line1\nline2' }],
    [{ key: 'v', label: 'V' }],
  );
  assert.equal(csv, 'V\r\n"a,b"\r\n"he said ""hi"""\r\n"line1\nline2"');
});

test('toCsv renders null/undefined as empty', () => {
  const csv = toCsv([{ v: null as unknown as string }], [{ key: 'v', label: 'V' }]);
  assert.equal(csv, 'V\r\n');
});

// ── computeQuoteTotals ───────────────────────────────────────────────────────

test('computeQuoteTotals sums qty*unitPrice and adds tax', () => {
  const r = computeQuoteTotals([
    { label: 'parts', qty: 2, unitPrice: 10 },
    { label: 'labor', qty: 1, unitPrice: 35.5 },
  ], 5);
  assert.equal(r.subtotal, 55.5);
  assert.equal(r.total, 60.5);
});

test('computeQuoteTotals defaults tax to 0 and rounds to cents', () => {
  const r = computeQuoteTotals([{ label: 'x', qty: 3, unitPrice: 0.1 }]);
  assert.equal(r.subtotal, 0.3);
  assert.equal(r.total, 0.3);
});

test('computeQuoteTotals handles empty / bad inputs', () => {
  assert.deepEqual(computeQuoteTotals([]), { subtotal: 0, total: 0 });
  assert.deepEqual(
    computeQuoteTotals([{ label: 'x', qty: NaN as unknown as number, unitPrice: 5 }]),
    { subtotal: 0, total: 0 },
  );
});

// ── buildEbayRefurbDraft ─────────────────────────────────────────────────────

function makeClaim(overrides: Partial<WarrantyClaimDetail> = {}): WarrantyClaimDetail {
  return {
    id: 1, claimNumber: 'WC-2026-00001', serialNumber: 'SN1', sku: 'BOSE-X', productTitle: 'Bose Speaker',
    orderId: null, customerId: null, customerName: null, status: 'REPAIRED', clockBasis: 'DELIVERED',
    warrantyStartsAt: null, warrantyExpiresAt: null, warrantyDays: 30, daysRemaining: null,
    denialReasonCode: null, rmaId: null, repairServiceId: null, zendeskTicketId: null, createdAt: '', updatedAt: '',
    purchaseProofUrl: null, purchasedAt: null, deliveredAt: null, packedScannedAt: null,
    sourceSystem: null, sourceOrderId: null, sourceTrackingNumber: null, denialNotes: null, notes: null,
    createdByStaffId: null, rmaNumber: null, repairTicket: null, events: [], quotes: [],
    repairAttempts: [
      { id: 1, attemptNo: 1, technicianStaffId: null, diagnosis: 'Replaced battery', partsUsed: [],
        outcome: 'FIXED', laborMinutes: null, costParts: null, costLabor: null,
        photoAttachmentIds: ['p1', 'p2'], notes: null, startedAt: null, completedAt: null, createdAt: '' },
    ],
    ...overrides,
  };
}

test('eBay draft: refurbished title, condition, photos aggregated', () => {
  const draft = buildEbayRefurbDraft(makeClaim());
  assert.match(draft.title, /Refurbished/);
  assert.equal(draft.conditionId, EBAY_SELLER_REFURBISHED_CONDITION_ID);
  assert.deepEqual(draft.photoAttachmentIds, ['p1', 'p2']);
  assert.match(draft.description, /Replaced battery/);
  assert.equal(draft.warning, undefined); // REPAIRED is sellable
});

test('eBay draft: title truncated to 80 chars', () => {
  const draft = buildEbayRefurbDraft(makeClaim({ productTitle: 'X'.repeat(120) }));
  assert.ok(draft.title.length <= 80, `title length ${draft.title.length}`);
});

test('eBay draft: non-sellable status carries a warning', () => {
  const draft = buildEbayRefurbDraft(makeClaim({ status: 'APPROVED' }));
  assert.ok(draft.warning && /APPROVED/.test(draft.warning));
});
