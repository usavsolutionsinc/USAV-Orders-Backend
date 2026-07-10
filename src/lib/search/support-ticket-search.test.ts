/**
 * DB-free tests for support-ticket exact bypass.
 * Run: npm run test:ai-search (added to script) or tsx --test this file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSupportTickets, resolveSupportTicketSearchHit } from './support-ticket-search';

const ORG = '11111111-2222-3333-4444-555555555555';

test('searchSupportTickets: non-ticket query returns empty without calling resolve', async () => {
  let called = 0;
  const hits = await searchSupportTickets(ORG, 'bose headphones', {
    resolve: async () => {
      called += 1;
      return null;
    },
  });
  assert.deepEqual(hits, []);
  assert.equal(called, 0);
});

test('searchSupportTickets: ticket-shaped miss returns empty', async () => {
  const hits = await searchSupportTickets(ORG, '#4821', {
    resolve: async () => null,
  });
  assert.deepEqual(hits, []);
});

test('searchSupportTickets: hit maps to receiving SearchHit shape', async () => {
  const hits = await searchSupportTickets(ORG, '#4821', {
    resolve: async (orgId, scan) => {
      assert.equal(orgId, ORG);
      assert.equal(scan, '#4821');
      return { receivingId: 55, lineId: 3, supportTicketId: 4821 };
    },
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entityType, 'receiving');
  assert.equal(hits[0].id, 55);
  assert.equal(hits[0].href, '/unbox?openReceivingId=55');
  assert.equal(hits[0].matchField, 'support_ticket');
  assert.ok(hits[0].title.includes('#4821'));
});

test('resolveSupportTicketSearchHit: wraps with score + chip', async () => {
  const hit = await resolveSupportTicketSearchHit(ORG, '4821', {
    resolve: async () => ({ receivingId: 10, supportTicketId: 9 }),
  });
  assert.ok(hit);
  assert.equal(hit!.score, 2000);
  assert.equal(hit!.chips[0]?.label, 'ticket');
});
