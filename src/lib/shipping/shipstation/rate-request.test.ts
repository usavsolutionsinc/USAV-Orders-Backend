import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShipmentSpec, RatesBodySchema, PurchaseLabelBodySchema, VoidLabelBodySchema } from './rate-request';
import type { ShipAddress } from './types';

/**
 * DB-free unit tests for the rates-body → ShipmentSpec builder and the
 * operator-route Zod schemas. Pure — no network, no DB.
 * Run: npx tsx --test src/lib/shipping/shipstation/rate-request.test.ts
 */

const warehouse: ShipAddress = {
  name: 'Warehouse',
  company: null,
  phone: null,
  addressLine1: '9 Dock Rd',
  addressLine2: null,
  cityLocality: 'Reno',
  stateProvince: 'NV',
  postalCode: '89502',
  countryCode: 'US',
  residential: false,
};

const bodyBase = {
  shipTo: {
    name: 'Jane Buyer',
    addressLine1: '1 Main St',
    cityLocality: 'Austin',
    stateProvince: 'TX',
    postalCode: '78701',
    countryCode: 'us',
  },
  parcels: [{ weight: { value: 32, unit: 'ounce' as const } }],
};

test('buildShipmentSpec: falls back to the warehouse origin when shipFrom is omitted', () => {
  const body = RatesBodySchema.parse(bodyBase);
  const spec = buildShipmentSpec(body, warehouse);
  assert.equal(spec.shipFrom, warehouse);
  assert.equal(spec.shipTo.name, 'Jane Buyer');
});

test('buildShipmentSpec: an explicit shipFrom wins over the fallback', () => {
  const body = RatesBodySchema.parse({
    ...bodyBase,
    shipFrom: {
      name: 'Alt Origin',
      addressLine1: '2 Side St',
      cityLocality: 'Sparks',
      stateProvince: 'NV',
      postalCode: '89431',
      countryCode: 'us',
    },
  });
  const spec = buildShipmentSpec(body, warehouse);
  assert.equal(spec.shipFrom.name, 'Alt Origin');
  assert.equal(spec.shipFrom.countryCode, 'US', 'country upper-cased');
});

test('buildShipmentSpec: normalizes ship-to country and preserves parcels/dims', () => {
  const body = RatesBodySchema.parse({
    ...bodyBase,
    parcels: [
      {
        weight: { value: 2.5, unit: 'pound' },
        dimensions: { length: 12, width: 10, height: 4, unit: 'inch' },
      },
    ],
  });
  const spec = buildShipmentSpec(body, warehouse);
  assert.equal(spec.shipTo.countryCode, 'US');
  assert.equal(spec.parcels.length, 1);
  assert.deepEqual(spec.parcels[0].weight, { value: 2.5, unit: 'pound' });
  assert.deepEqual(spec.parcels[0].dimensions, { length: 12, width: 10, height: 4, unit: 'inch' });
});

test('buildShipmentSpec: parcels without dimensions get dimensions: null', () => {
  const spec = buildShipmentSpec(RatesBodySchema.parse(bodyBase), warehouse);
  assert.equal(spec.parcels[0].dimensions, null);
});

test('buildShipmentSpec: empty/blank carrierIds are dropped (= all connected carriers)', () => {
  const empty = buildShipmentSpec(RatesBodySchema.parse({ ...bodyBase, carrierIds: [] }), warehouse);
  assert.equal(empty.carrierIds, undefined);

  const some = buildShipmentSpec(
    RatesBodySchema.parse({ ...bodyBase, carrierIds: ['se-1', 'se-9'] }),
    warehouse,
  );
  assert.deepEqual(some.carrierIds, ['se-1', 'se-9']);
});

test('buildShipmentSpec: confirmation passes through; absent → undefined', () => {
  const none = buildShipmentSpec(RatesBodySchema.parse(bodyBase), warehouse);
  assert.equal(none.confirmation, undefined);

  const sig = buildShipmentSpec(
    RatesBodySchema.parse({ ...bodyBase, confirmation: 'signature' }),
    warehouse,
  );
  assert.equal(sig.confirmation, 'signature');
});

test('RatesBodySchema: rejects missing parcels and bad country codes', () => {
  assert.equal(RatesBodySchema.safeParse({ ...bodyBase, parcels: [] }).success, false);
  assert.equal(
    RatesBodySchema.safeParse({
      ...bodyBase,
      shipTo: { ...bodyBase.shipTo, countryCode: 'USA' },
    }).success,
    false,
  );
});

test('PurchaseLabelBodySchema: requires rateId + clientEventId', () => {
  assert.equal(PurchaseLabelBodySchema.safeParse({ rateId: 'r-1' }).success, false);
  assert.equal(PurchaseLabelBodySchema.safeParse({ rateId: '', clientEventId: 'k' }).success, false);
  const ok = PurchaseLabelBodySchema.safeParse({ rateId: 'r-1', clientEventId: 'k-1', labelFormat: 'zpl' });
  assert.equal(ok.success, true);
});

test('VoidLabelBodySchema: reason is mandatory (AUDIT_REASON_REQUIRED)', () => {
  assert.equal(VoidLabelBodySchema.safeParse({ labelId: 'l-1' }).success, false);
  assert.equal(VoidLabelBodySchema.safeParse({ labelId: 'l-1', reason: '  ' }).success, false);
  assert.equal(VoidLabelBodySchema.safeParse({ labelId: 'l-1', reason: 'wrong service' }).success, true);
});
