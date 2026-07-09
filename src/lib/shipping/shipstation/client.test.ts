import test from 'node:test';
import assert from 'node:assert/strict';
import { createShipStationV2Client } from './client';
import type { ShipAddress } from './types';

/**
 * DB-free unit tests for the v2 client's raw→normalized MAPPING — the layer most
 * likely to hide bugs. `fetch` is stubbed with canned ShipStation responses; no
 * network, no DB. Run: npx tsx --test src/lib/shipping/shipstation/client.test.ts
 */

function stubFetch(routes: Record<string, unknown>): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/v2/, '').split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    for (const [prefix, body] of Object.entries(routes)) {
      if (key.startsWith(prefix)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ errors: [{ message: `unmocked ${key}` }] }), { status: 404 });
  }) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

const addr = (): ShipAddress => ({
  name: 'Test', addressLine1: '1 Test St', cityLocality: 'City', stateProvince: 'CA', postalCode: '90000', countryCode: 'US',
});

test('getRates: maps fields, sorts cheapest-first, drops errored rates, keeps invalid_rates', async () => {
  const restore = stubFetch({
    'POST /rates': {
      rate_response: {
        rates: [
          { rate_id: 'r-ups', carrier_id: 'se-9', carrier_code: 'ups', carrier_friendly_name: 'UPS', service_type: 'UPS Ground', service_code: 'ups_ground', shipping_amount: { currency: 'usd', amount: 12.5 }, delivery_days: 3 },
          { rate_id: 'r-usps', carrier_id: 'se-1', carrier_code: 'stamps_com', carrier_friendly_name: 'USPS', service_type: 'USPS Priority', service_code: 'usps_priority_mail', shipping_amount: { currency: 'usd', amount: 7.53 }, insurance_amount: { currency: 'usd', amount: 1.5 }, delivery_days: 2 },
          { rate_id: 'r-bad', carrier_code: 'fedex', shipping_amount: { currency: 'usd', amount: 0 }, error_messages: ['no service available'] },
        ],
        invalid_rates: [{ carrier_code: 'dhl', error_messages: ['unsupported destination'] }],
        rate_request_id: 'rr-1', shipment_id: 'se-ship-1', status: 'completed',
      },
    },
  });
  try {
    const client = createShipStationV2Client('TEST-KEY');
    const result = await client.getRates({
      shipTo: addr(), shipFrom: addr(), parcels: [{ weight: { value: 16, unit: 'ounce' } }], carrierIds: ['se-1', 'se-9'],
    });
    assert.equal(result.rates.length, 2, 'the errored/zero rate is dropped');
    assert.equal(result.rates[0].rateId, 'r-usps', 'cheapest first (7.53 < 12.50)');
    assert.equal(result.rates[0].amount, 7.53);
    assert.equal(result.rates[0].currency, 'USD', 'currency upper-cased');
    assert.equal(result.rates[0].otherAmount, 1.5, 'insurance summed into otherAmount');
    assert.equal(result.rates[0].deliveryDays, 2);
    assert.equal(result.rates[1].rateId, 'r-ups');
    assert.equal(result.invalidRates.length, 1);
    assert.equal(result.engineShipmentId, 'se-ship-1');
    assert.equal(result.rateRequestId, 'rr-1');
  } finally {
    restore();
  }
});

test('purchaseLabelFromRate: maps the label response into LabelPurchaseResult', async () => {
  const restore = stubFetch({
    'POST /labels/rates/': {
      label_id: 'se-lbl-1', status: 'completed', shipment_id: 'se-ship-1', ship_date: '2026-07-01T08:00:00Z',
      shipment_cost: { currency: 'usd', amount: 17.58 }, insurance_cost: { currency: 'usd', amount: 0 },
      tracking_number: '1ZTEST0001', carrier_id: 'se-9', carrier_code: 'ups', service_code: 'ups_ground',
      label_download: { href: 'https://dl/label.pdf', pdf: 'https://dl/label.pdf', png: 'https://dl/label.png', zpl: 'https://dl/label.zpl' },
    },
  });
  try {
    const client = createShipStationV2Client('TEST-KEY');
    const label = await client.purchaseLabelFromRate('r-usps', { labelFormat: 'pdf' });
    assert.equal(label.labelId, 'se-lbl-1');
    assert.equal(label.trackingNumber, '1ZTEST0001');
    assert.equal(label.carrierCode, 'ups');
    assert.equal(label.serviceCode, 'ups_ground');
    assert.equal(label.cost, 17.58);
    assert.equal(label.currency, 'USD');
    assert.equal(label.labelDownload.pdf, 'https://dl/label.pdf');
    assert.equal(label.labelDownload.zpl, 'https://dl/label.zpl');
  } finally {
    restore();
  }
});

test('voidLabel: normalizes the approval result', async () => {
  const restore = stubFetch({ 'PUT /labels/': { approved: true, message: 'Refund submitted.' } });
  try {
    const client = createShipStationV2Client('TEST-KEY');
    const result = await client.voidLabel('se-lbl-1');
    assert.equal(result.approved, true);
    assert.equal(result.message, 'Refund submitted.');
  } finally {
    restore();
  }
});

test('API error surfaces the ShipStation error message', async () => {
  const restore = () => { globalThis.fetch = orig; };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: 'A carrier_id is required.' }] }), { status: 400 })) as typeof fetch;
  try {
    const client = createShipStationV2Client('TEST-KEY');
    await assert.rejects(
      () => client.purchaseLabelFromRate('r-x'),
      /A carrier_id is required\./,
    );
  } finally {
    restore();
  }
});
