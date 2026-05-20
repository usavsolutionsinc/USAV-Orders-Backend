/**
 * Resolver decision-tree tests.
 *
 * We pass a stubbed `LookupDeps` so the tests run without a live
 * Postgres. The point is to exercise the priority tree, not the DB
 * helpers (which have their own coverage at the integration layer).
 */

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import {
  resolveGs1,
  resolveInternal,
  resolvePublic,
  PUBLIC_LANDING_URL,
  type LookupDeps,
} from './resolver';

const STORE = PUBLIC_LANDING_URL;

function deps(overrides: Partial<LookupDeps> = {}): LookupDeps {
  return {
    getLocationByBarcode: async () => null,
    findByNormalizedSerial: async () => null,
    getSkuCatalogByGtin: async () => null,
    ...overrides,
  };
}

test('public branch always lands on the storefront, no DB calls', async () => {
  let called = false;
  const result = await resolveGs1('/01/0614141000005/21/ABC', {
    isInternal: false,
    deps: deps({
      getSkuCatalogByGtin: async () => {
        called = true;
        return { sku: 'CABLE-001' };
      },
    }),
  });
  strictEqual(result.kind, 'public');
  strictEqual(result.redirect, STORE);
  strictEqual(called, false);
});

test('public branch tolerates unparseable input', async () => {
  const result = await resolveGs1('not a url', { isInternal: false });
  strictEqual(result.kind, 'public');
  strictEqual(result.redirect, STORE);
});

test('internal branch resolves a location code to /inventory?bin=...', async () => {
  const result = await resolveGs1('/414/0614141000005/254/C0101101', {
    isInternal: true,
    deps: deps({ getLocationByBarcode: async () => ({ id: 42 }) }),
  });
  strictEqual(result.kind, 'location');
  strictEqual(result.redirect, '/inventory?bin=C0101101');
  strictEqual(result.entityId, 42);
  strictEqual(result.matchedAi, '254');
});

test('location precedence — location wins even when a GTIN is also present', async () => {
  // Shouldn't happen in practice (our printer never combines these),
  // but the priority tree should still be deterministic.
  const ctx = {
    rawUrl: 'x',
    path: '/01/0614141000005/254/C0101101',
    aiMap: { '01': '0614141000005', '254': 'C0101101' },
    gtin: '0614141000005',
    locationCode: 'C0101101',
  };
  const result = await resolveInternal(ctx, deps());
  strictEqual(result.kind, 'location');
});

test('internal branch resolves a serial to /serial/...', async () => {
  const result = await resolveGs1('/01/0614141000005/21/ABC123', {
    isInternal: true,
    deps: deps({ findByNormalizedSerial: async () => ({ id: 7 }) }),
  });
  strictEqual(result.kind, 'serial-unit');
  strictEqual(result.redirect, '/serial/ABC123');
  strictEqual(result.entityId, 7);
  strictEqual(result.matchedAi, '21');
});

test('serial precedence — serial wins over GTIN-only', async () => {
  const result = await resolveGs1('/01/0614141000005/21/SER', {
    isInternal: true,
    deps: deps({ findByNormalizedSerial: async () => null }),
  });
  strictEqual(result.kind, 'serial-unit');
  // Missing serial in DB still redirects — page renders a not-found state.
  strictEqual(result.redirect, '/serial/SER');
  strictEqual(result.entityId, undefined);
});

test('internal GTIN-only with known SKU lands on /products/{sku}', async () => {
  const result = await resolveGs1('/01/0614141000005', {
    isInternal: true,
    deps: deps({ getSkuCatalogByGtin: async () => ({ sku: 'CABLE-001' }) }),
  });
  strictEqual(result.kind, 'sku');
  strictEqual(result.redirect, '/products/CABLE-001');
  strictEqual(result.entityId, 'CABLE-001');
  strictEqual(result.matchedAi, '01');
});

test('internal GTIN-only with unknown GTIN falls back to /inventory', async () => {
  const result = await resolveGs1('/01/9999999999999', {
    isInternal: true,
    deps: deps({ getSkuCatalogByGtin: async () => null }),
  });
  strictEqual(result.kind, 'fallback');
  strictEqual(result.redirect, '/inventory');
  strictEqual(result.matchedAi, '01');
});

test('internal branch falls back to /inventory on unparseable input', async () => {
  const result = await resolveGs1('garbage scan', { isInternal: true });
  strictEqual(result.kind, 'fallback');
  strictEqual(result.redirect, '/inventory');
});

test('resolvePublic is pure — never throws', () => {
  const result = resolvePublic({
    rawUrl: '',
    path: '',
    aiMap: {},
  });
  strictEqual(result.kind, 'public');
  ok(result.redirect.startsWith('http'));
});

test('SKU is URL-encoded so a slash in the SKU does not break the redirect', async () => {
  const result = await resolveGs1('/01/0614141000005', {
    isInternal: true,
    deps: deps({ getSkuCatalogByGtin: async () => ({ sku: 'WEIRD/SKU' }) }),
  });
  strictEqual(result.redirect, '/products/WEIRD%2FSKU');
});
