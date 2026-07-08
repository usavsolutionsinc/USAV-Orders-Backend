/**
 * Unit coverage for `looksLikeReceivingCode` — the synchronous predicate the
 * receiving scan bar uses to decide whether to run the canonical-code resolver
 * even when the dash auto-classify heuristic armed Order# mode.
 *
 * The contract that matters: every canonical internal handle (which all carry
 * a dash, so `classifyUnboxScan` would otherwise route them to the PO lookup)
 * returns true, while genuine PO / order / tracking values return false so
 * their existing lookup-po routing is left untouched.
 */

import { test } from 'node:test';
import { strictEqual, equal, deepEqual } from 'node:assert';

import {
  looksLikeReceivingCode,
  resolveReceivingCodeToLine,
  stubRowFromCartonHeader,
} from './resolve-testing-scan';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

test('canonical handles are recognised as codes (resolve even in Order# mode)', () => {
  for (const v of [
    'R-1234',        // carton handle — the printed receiving label
    'r-7',           // case-insensitive
    'RCV-58',        // legacy carton string
    'H-12',          // handling-unit (LPN)
    'L-900',         // receiving line
    'U-451',         // serial unit
    'REP-33',        // repair label
    '00098-2621-000142', // printed unit-id {SKU}-{YYWW}-{SEQ6}
    'IPH13-128-2621-000142', // unit-id whose short SKU itself has a dash
  ]) {
    strictEqual(looksLikeReceivingCode(v), true, `${v} should be a code`);
  }
});

test('PO / order / tracking values are NOT codes (keep lookup-po routing)', () => {
  for (const v of [
    'PO-00123',                 // Zoho PO number
    '111-2222222-3333333',      // Amazon order number
    '1Z999AA10123456784',       // UPS tracking (no dash)
    '9400111899223456781234',   // USPS tracking
    'A-01-01-1',                // bin / location code
    '12345:HP-PSU',             // static SKU
    '',                         // empty
    '   ',                      // whitespace
  ]) {
    strictEqual(looksLikeReceivingCode(v), false, `${v} should NOT be a code`);
  }
});

test('surrounding whitespace is tolerated', () => {
  strictEqual(looksLikeReceivingCode('  R-1234  '), true);
  strictEqual(looksLikeReceivingCode('\tH-9\n'), true);
});

test('bare product SKUs are NOT codes (fall through to the SKU pre-pack branch)', () => {
  // P1-PCK-01: a scanned product/pre-pack SKU must NOT be classified as a
  // canonical handle/unit-id — it has to fall through resolveTestingScan to the
  // fetchLinesBySku branch so the panel prefills from the pre-packed line.
  for (const v of [
    'HP-PSU',          // hyphenated SKU, no {YYWW}-{SEQ6} unit-id tail
    'BOSE-QC35',       // brand SKU
    'SKU12345',        // plain alphanumeric SKU
    'WH1000XM4',       // model-style SKU
  ]) {
    strictEqual(looksLikeReceivingCode(v), false, `${v} should fall through to SKU resolve`);
  }
});

// ── resolveReceivingCodeToLine — lineless unfound carton handles ─────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchMock(
  handlers: Record<string, (url: string) => Response | Promise<Response>>,
): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (url.includes(prefix)) return handler(url);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

test('stubRowFromCartonHeader maps unmatched carton fields onto the synthetic row', () => {
  const row = stubRowFromCartonHeader(42, 'R-42', {
    tracking: '1Z999AA10123456784',
    source: 'unmatched',
    carrier: 'UPS',
    zoho_purchaseorder_number: null,
  });
  equal(row.receiving_id, 42);
  equal(row.tracking_number, '1Z999AA10123456784');
  equal(row.receiving_source, 'unmatched');
  equal(row.carrier, 'UPS');
  equal(row.item_name, 'Unfound PO');
  equal(row.id, -42);
});

test('R-{id} with zero lines + existing carton → line stub (not not_found)', async () => {
  const restore = installFetchMock({
    '/api/receiving-lines?receiving_id=42': () =>
      jsonResponse({ receiving_lines: [] }),
    '/api/receiving/42': () =>
      jsonResponse({
        success: true,
        receiving: {
          id: 42,
          tracking: 'TRK-ABC',
          source: 'unmatched',
          carrier: 'FEDEX',
        },
      }),
  });
  try {
    const result = await resolveReceivingCodeToLine('R-42');
    equal(result?.kind, 'line');
    if (result?.kind !== 'line') return;
    equal(result.via, 'handle');
    equal(result.row.receiving_id, 42);
    equal(result.row.receiving_source, 'unmatched');
    equal(result.row.tracking_number, 'TRK-ABC');
  } finally {
    restore();
  }
});

test('R-{id} with zero lines + carton 404 → not_found', async () => {
  const restore = installFetchMock({
    '/api/receiving-lines?receiving_id=999': () =>
      jsonResponse({ receiving_lines: [] }),
    '/api/receiving/999': () =>
      jsonResponse({ success: false, error: 'Package not found' }, 404),
  });
  try {
    const result = await resolveReceivingCodeToLine('R-999');
    deepEqual(result, { kind: 'not_found', query: 'R-999' });
  } finally {
    restore();
  }
});

test('R-{id} with one real line → opens that line unchanged', async () => {
  const realLine = {
    id: 7,
    receiving_id: 42,
    sku: '00001-BK',
    quantity_received: 0,
    quantity_expected: 1,
  } as ReceivingLineRow;
  const restore = installFetchMock({
    '/api/receiving-lines?receiving_id=42': () =>
      jsonResponse({ receiving_lines: [realLine] }),
  });
  try {
    const result = await resolveReceivingCodeToLine('R-42');
    equal(result?.kind, 'line');
    if (result?.kind !== 'line') return;
    equal(result.row.id, 7);
    equal(result.row.sku, '00001-BK');
  } finally {
    restore();
  }
});
