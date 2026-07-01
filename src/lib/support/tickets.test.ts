import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSupportTicketDisplayLabel,
  formatSupportTicketLabel,
  normalizeReceivingTicketEntityRefs,
} from './tickets';

test('formatSupportTicketLabel uses internal registry id', () => {
  assert.equal(formatSupportTicketLabel(42), '#42');
});

test('formatSupportTicketDisplayLabel uses Zendesk external id for claims parity', () => {
  assert.equal(
    formatSupportTicketDisplayLabel({
      id: 7,
      provider: 'zendesk',
      externalTicketId: '9395',
      subjectCache: null,
      statusCache: null,
    }),
    '#9395',
  );
});

test('formatSupportTicketDisplayLabel falls back to internal id for internal tickets', () => {
  assert.equal(
    formatSupportTicketDisplayLabel({
      id: 42,
      provider: 'internal',
      externalTicketId: null,
      subjectCache: null,
      statusCache: null,
    }),
    '#42',
  );
});

test('normalizeReceivingTicketEntityRefs maps placeholder line id to receiving', () => {
  assert.deepEqual(
    normalizeReceivingTicketEntityRefs({ lineId: -6936, receivingId: 6936 }),
    { lineId: null, receivingId: 6936 },
  );
  assert.deepEqual(
    normalizeReceivingTicketEntityRefs({ lineId: -6936, receivingId: null }),
    { lineId: null, receivingId: 6936 },
  );
  assert.deepEqual(
    normalizeReceivingTicketEntityRefs({ lineId: 42, receivingId: 6936 }),
    { lineId: 42, receivingId: 6936 },
  );
});
