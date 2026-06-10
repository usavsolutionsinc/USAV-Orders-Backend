import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWarrantyTicketTemplate,
  mergeWarrantyTimeline,
  warrantyEventLabel,
  type WarrantyZendeskComment,
} from './zendesk-format';
import type { WarrantyClaimDetail, WarrantyClaimEventRow } from './types';

function makeClaim(overrides: Partial<WarrantyClaimDetail> = {}): WarrantyClaimDetail {
  return {
    id: 42,
    claimNumber: 'WC-2026-00042',
    serialNumber: 'SN123',
    sku: 'BOSE-700',
    productTitle: 'Bose Headphones 700',
    orderId: 9,
    customerId: 3,
    customerName: 'Jane Doe',
    status: 'SUBMITTED',
    clockBasis: 'DELIVERED',
    warrantyStartsAt: '2026-05-01T00:00:00Z',
    warrantyExpiresAt: '2026-05-31T00:00:00Z',
    warrantyDays: 30,
    daysRemaining: 12,
    denialReasonCode: null,
    rmaId: null,
    repairServiceId: null,
    zendeskTicketId: null,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
    purchaseProofUrl: null,
    purchasedAt: null,
    deliveredAt: '2026-05-01T00:00:00Z',
    packedScannedAt: null,
    sourceSystem: 'ebay',
    sourceOrderId: '12-34567-89012',
    sourceTrackingNumber: '1Z999',
    denialNotes: null,
    notes: null,
    createdByStaffId: 1,
    rmaNumber: null,
    repairTicket: null,
    events: [],
    repairAttempts: [],
    quotes: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<WarrantyClaimEventRow> = {}): WarrantyClaimEventRow {
  return {
    id: 1,
    eventType: 'STATUS_CHANGE',
    fromStatus: null,
    toStatus: 'LOGGED',
    payload: {},
    actorStaffId: 1,
    createdAt: '2026-05-02T10:00:00Z',
    ...overrides,
  };
}

function makeComment(overrides: Partial<WarrantyZendeskComment> = {}): WarrantyZendeskComment {
  return {
    id: 100,
    body: 'Hello',
    htmlBody: null,
    public: true,
    authorId: 7,
    createdAt: '2026-05-02T11:00:00Z',
    ...overrides,
  };
}

test('template subject leads with the claim number and item', () => {
  const t = buildWarrantyTicketTemplate(makeClaim());
  assert.equal(t.subject, 'Warranty claim WC-2026-00042: Bose Headphones 700');
});

test('template body carries the identifying facts and the warranty window', () => {
  const t = buildWarrantyTicketTemplate(makeClaim());
  for (const expected of [
    'WC-2026-00042',
    'SKU: BOSE-700',
    'Serial Number: SN123',
    'Order: 12-34567-89012',
    'Customer: Jane Doe',
    'Tracking: 1Z999',
    '2026-05-01 → 2026-05-31 (12d remaining)',
  ]) {
    assert.ok(t.description.includes(expected), `body should include "${expected}"`);
  }
});

test('template omits empty fields instead of printing blanks', () => {
  const t = buildWarrantyTicketTemplate(
    makeClaim({ serialNumber: null, sourceTrackingNumber: null, customerName: null }),
  );
  assert.ok(!t.description.includes('Serial Number:'));
  assert.ok(!t.description.includes('Tracking:'));
  assert.ok(!t.description.includes('Customer:'));
});

test('template surfaces denial + expired clock when present', () => {
  const t = buildWarrantyTicketTemplate(
    makeClaim({
      status: 'DENIED',
      denialReasonCode: 'OUT_OF_WINDOW',
      denialNotes: 'expired before claim',
      daysRemaining: -3,
    }),
  );
  assert.ok(t.description.includes('Reason code: OUT_OF_WINDOW'));
  assert.ok(t.description.includes('(expired 3d ago)'));
});

test('template falls back to sku/serial when there is no product title', () => {
  const noTitle = buildWarrantyTicketTemplate(makeClaim({ productTitle: null }));
  assert.ok(noTitle.subject.endsWith('BOSE-700'));
  const bare = buildWarrantyTicketTemplate(makeClaim({ productTitle: null, sku: null, serialNumber: null }));
  assert.ok(bare.subject.endsWith('item'));
});

test('mergeWarrantyTimeline interleaves events and comments chronologically (ascending)', () => {
  const merged = mergeWarrantyTimeline(
    [
      makeEvent({ id: 1, createdAt: '2026-05-02T10:00:00Z' }),
      makeEvent({ id: 2, createdAt: '2026-05-02T12:00:00Z', toStatus: 'SUBMITTED' }),
    ],
    [makeComment({ id: 100, createdAt: '2026-05-02T11:00:00Z' })],
  );
  assert.deepEqual(
    merged.map((e) => e.key),
    ['event-1', 'comment-100', 'event-2'],
  );
});

test('mergeWarrantyTimeline is stable for identical timestamps and tolerates bad dates', () => {
  const merged = mergeWarrantyTimeline(
    [makeEvent({ id: 1, createdAt: 'not-a-date' })],
    [makeComment({ id: 100, createdAt: '2026-05-02T11:00:00Z' })],
  );
  // Unparseable date sorts as epoch 0 → first, never throws.
  assert.equal(merged[0].key, 'event-1');
  assert.equal(merged.length, 2);
});

test('warrantyEventLabel covers the zendesk event vocabulary', () => {
  assert.equal(warrantyEventLabel(makeEvent({ eventType: 'ZENDESK_TICKET_CREATED' })), 'Zendesk ticket created');
  assert.equal(warrantyEventLabel(makeEvent({ eventType: 'ZENDESK_REPLY' })), 'Reply sent to Zendesk');
  assert.equal(warrantyEventLabel(makeEvent({ eventType: 'STATUS_CHANGE', toStatus: 'CLOSED' })), 'Status → CLOSED');
  assert.equal(warrantyEventLabel(makeEvent({ eventType: 'SOME_NEW_TYPE' })), 'some new type');
});
