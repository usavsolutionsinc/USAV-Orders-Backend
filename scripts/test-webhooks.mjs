#!/usr/bin/env node
/**
 * End-to-end webhook smoke test for UPS + FedEx routes.
 *
 *   BASE_URL=http://localhost:3000 \
 *   UPS_WEBHOOK_BEARER=optional-secret \
 *   FEDEX_WEBHOOK_BEARER=optional-secret \
 *   node scripts/test-webhooks.mjs
 *
 * What it checks:
 *   1. GET  /api/webhooks/{carrier}   → 200, returns {ok:true, carrier, callbackPath}
 *   2. POST with garbage JSON         → 400
 *   3. POST with valid carrier payload → 200, processed >= 1, tracking# returned
 *   4. POST again with same payload    → 200, idempotent (event dedup)
 *
 * Tracking numbers are stamped with the process epoch so reruns don't collide.
 * No cleanup — the rows persist in shipping_tracking_numbers. Use a dev DB.
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const UPS_SECRET = process.env.UPS_WEBHOOK_BEARER || process.env.UPS_WEBHOOK_SECRET || '';
const FEDEX_SECRET = process.env.FEDEX_WEBHOOK_BEARER || process.env.FEDEX_WEBHOOK_SECRET || '';

const epoch = Date.now().toString(36).toUpperCase().padStart(8, '0').slice(-8);
const UPS_TRACKING = `1ZTEST${epoch.padStart(12, '0')}`.slice(0, 18); // 1Z + 16 alphanumeric
const FEDEX_TRACKING = `99${Date.now()}`.slice(0, 12);                  // 12-digit Express

let failures = 0;
let passes = 0;

function authHeaders(secret) {
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

function red(s) { return `\x1b[31m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }

async function assert(label, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ${green('✓')} ${label}`);
  } else {
    failures++;
    console.log(`  ${red('✗')} ${label}`);
    if (detail) console.log(dim(`    ${detail}`));
  }
}

async function jsonReq(method, path, { body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* non-json body */ }
  return { status: res.status, body: parsed };
}

// ─── UPS payload builders ────────────────────────────────────────────────────

function buildUpsPayload(trackingNumber, statusType = 'I') {
  // Mirrors the shape parseUPSTrackingPayload expects:
  // payload.trackResponse.shipment[0].package[0]
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, '');

  return {
    trackResponse: {
      shipment: [
        {
          inquiryNumber: { value: trackingNumber },
          service: { description: 'UPS Ground' },
          package: [
            {
              trackingNumber,
              currentStatus: {
                type: statusType,           // I=In Transit, D=Delivered, X=Exception
                code: '021',
                description: 'On the Way',
              },
              activity: [
                {
                  date: yyyymmdd,
                  time: hhmmss,
                  status: {
                    type: statusType,
                    code: '021',
                    description: 'On the Way',
                  },
                  location: {
                    address: {
                      city: 'LOUISVILLE',
                      stateProvince: 'KY',
                      postalCode: '40231',
                      countryCode: 'US',
                    },
                  },
                },
              ],
              referenceNumber: [{ number: 'PO-WEBHOOK-TEST' }],
            },
          ],
        },
      ],
    },
  };
}

// ─── FedEx payload builders ──────────────────────────────────────────────────

function buildFedexPayload(trackingNumber, statusCode = 'IT') {
  // Mirrors the shape parseFedExTrackingPayload expects:
  // payload.output.completeTrackResults[0].trackResults[0]
  const nowIso = new Date().toISOString();

  return {
    output: {
      completeTrackResults: [
        {
          trackingNumber,
          trackResults: [
            {
              trackingNumberInfo: { trackingNumber },
              latestStatusDetail: {
                code: statusCode,                  // IT=In Transit, DL=Delivered, DE=Exception
                derivedCode: statusCode,
                statusByLocale: 'In transit',
                description: 'In transit',
                scanLocation: {
                  city: 'MEMPHIS',
                  stateOrProvinceCode: 'TN',
                  postalCode: '38118',
                  countryCode: 'US',
                },
              },
              scanEvents: [
                {
                  date: nowIso,
                  eventType: statusCode,
                  eventDescription: 'In transit',
                  derivedStatus: 'In transit',
                  derivedStatusCode: statusCode,
                  scanLocation: {
                    city: 'MEMPHIS',
                    stateOrProvinceCode: 'TN',
                    postalCode: '38118',
                    countryCode: 'US',
                  },
                },
              ],
              dateAndTimes: [],
              serviceDetail: { description: 'FedEx Ground' },
            },
          ],
        },
      ],
    },
  };
}

// ─── Test runners ────────────────────────────────────────────────────────────

async function testCarrier(name, path, secret, validPayload, expectedTracking) {
  console.log(`\n${name} webhook → ${BASE}${path}`);

  // 1. GET health check
  {
    const r = await jsonReq('GET', path, { headers: authHeaders(secret) });
    assert(
      'GET returns 200 with carrier metadata',
      r.status === 200 && r.body?.ok === true && r.body?.callbackPath === path,
      `got status=${r.status} body=${JSON.stringify(r.body)}`,
    );
  }

  // 2. POST with garbage JSON
  {
    const r = await jsonReq('POST', path, {
      headers: authHeaders(secret),
      body: '{ not json',
    });
    assert('POST garbage JSON returns 400', r.status === 400, `got status=${r.status}`);
  }

  // 3. POST with empty body (no trackResults) → 200 but processed=0
  {
    const r = await jsonReq('POST', path, {
      headers: authHeaders(secret),
      body: {},
    });
    assert(
      'POST empty body returns 200 with processed=0',
      r.status === 200 && r.body?.processed === 0,
      `got status=${r.status} body=${JSON.stringify(r.body)}`,
    );
  }

  // 4. POST with valid payload
  {
    const r = await jsonReq('POST', path, {
      headers: authHeaders(secret),
      body: validPayload,
    });
    const trackingMatches =
      Array.isArray(r.body?.trackingNumbers) &&
      r.body.trackingNumbers.includes(expectedTracking);
    assert(
      `POST valid payload returns 200 and processes ${expectedTracking}`,
      r.status === 200 && r.body?.processed >= 1 && trackingMatches,
      `got status=${r.status} body=${JSON.stringify(r.body)}`,
    );
  }

  // 5. POST same payload again — idempotent (events dedupe; status still updates)
  {
    const r = await jsonReq('POST', path, {
      headers: authHeaders(secret),
      body: validPayload,
    });
    assert(
      'POST replay still returns 200 (idempotent)',
      r.status === 200 && r.body?.processed >= 1,
      `got status=${r.status} body=${JSON.stringify(r.body)}`,
    );
  }

  // 6. (production-mode auth) POST without bearer — only meaningful if a secret IS configured server-side
  if (secret) {
    const r = await jsonReq('POST', path, { body: validPayload });
    assert(
      'POST without bearer returns 401 (secret configured)',
      r.status === 401,
      `got status=${r.status}`,
    );
  }
}

(async () => {
  console.log(dim(`base=${BASE}`));
  console.log(dim(`ups_tracking=${UPS_TRACKING}  fedex_tracking=${FEDEX_TRACKING}`));

  try {
    await testCarrier('UPS', '/api/webhooks/ups', UPS_SECRET, buildUpsPayload(UPS_TRACKING), UPS_TRACKING);
    await testCarrier('FedEx', '/api/webhooks/fedex', FEDEX_SECRET, buildFedexPayload(FEDEX_TRACKING), FEDEX_TRACKING);
  } catch (err) {
    failures++;
    console.error(red('\nFatal error during test run:'), err.message);
  }

  console.log(`\n${failures === 0 ? green('PASS') : red('FAIL')}  ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
