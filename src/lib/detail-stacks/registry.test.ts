/**
 * detailStackHref — rebuilds deep links for the assistant context rail.
 * Run: npx tsx --test src/lib/detail-stacks/registry.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detailStackHref } from './registry';

test('detailStackHref: orders always reopen on /dashboard', () => {
  assert.equal(
    detailStackHref({ kind: 'order', id: '6057', path: '/pack' }),
    '/dashboard?openOrderId=6057',
  );
});

test('detailStackHref: preserves dashboard view params from stored search', () => {
  assert.equal(
    detailStackHref({
      kind: 'order',
      id: '6057',
      path: '/dashboard',
      search: 'shipped=&openOrderId=19361',
    }),
    '/dashboard?shipped=&openOrderId=6057',
  );
});

test('detailStackHref: shipments canonicalize to /fba', () => {
  assert.equal(
    detailStackHref({ kind: 'shipment', id: '2', path: '/dashboard', search: 'openShipmentId=1' }),
    '/fba?openShipmentId=2',
  );
});

test('detailStackHref: receiving keeps the surface path + mode params', () => {
  assert.equal(
    detailStackHref({
      kind: 'receiving',
      id: '99',
      path: '/unbox',
      search: 'mode=receive&openReceivingId=12',
    }),
    '/unbox?mode=receive&openReceivingId=99',
  );
});
