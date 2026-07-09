import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INBOUND_SOURCE_TYPES,
  INBOUND_SOURCE_LABELS,
  INBOUND_SOURCE_FACT_KIND,
  isRegisteredInboundSource,
  assertRegisteredInboundSource,
} from './source-registry';

test('isRegisteredInboundSource is true only for registered slugs', () => {
  assert.equal(isRegisteredInboundSource('zoho'), true);
  assert.equal(isRegisteredInboundSource('ebay'), true);
  assert.equal(isRegisteredInboundSource('shopify'), false);
  assert.equal(isRegisteredInboundSource(''), false);
});

test('assertRegisteredInboundSource throws on an unregistered source', () => {
  assert.doesNotThrow(() => assertRegisteredInboundSource('amazon'));
  assert.throws(() => assertRegisteredInboundSource('etsy'), /unregistered source_type "etsy"/);
});

test('every source has a label; ebay maps to its facts kind', () => {
  for (const t of INBOUND_SOURCE_TYPES) {
    assert.equal(typeof INBOUND_SOURCE_LABELS[t], 'string');
    assert.ok(INBOUND_SOURCE_LABELS[t].length > 0);
    assert.ok(t in INBOUND_SOURCE_FACT_KIND);
  }
  assert.equal(INBOUND_SOURCE_FACT_KIND.ebay, 'ebay_purchase');
  assert.equal(INBOUND_SOURCE_FACT_KIND.zoho, null);
});

// ── Drift guard: the code registry and every DB *discriminator-domain* CHECK
//    must enumerate the SAME set (plan §2.3 / the polymorphic contract). If they
//    drift, a write the app accepts would violate a DB CHECK (or vice-versa) —
//    fail loudly here instead. Keyed off the constraint NAME so the conditional
//    receiving_lines_zoho_item_required_chk (which deliberately lists only the
//    non-zoho sources) is not mistaken for a domain enumeration.
const DOMAIN_CHK_NAME = /(source_type_chk|type_a_chk|type_b_chk|primary_type_chk|secondary_type_chk)$/;

test('DB source_type domain CHECKs match the code registry', () => {
  const expected = [...INBOUND_SOURCE_TYPES].sort();
  const files = [
    new URL('../migrations/2026-07-01k_inbound_polymorphic_purchase_tables.sql', import.meta.url),
    new URL('../migrations/2026-07-01l_inbound_spine_cache_and_ebay_role.sql', import.meta.url),
  ];
  let checkCount = 0;
  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    // Each domain CHECK is `ADD CONSTRAINT <name> ... IN ('a','b',...)`.
    const matches = [...sql.matchAll(/ADD CONSTRAINT\s+(\w+)[\s\S]*?IN \(([^)]+)\)/gi)];
    for (const m of matches) {
      if (!DOMAIN_CHK_NAME.test(m[1])) continue;
      const vals = [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
      assert.deepEqual(vals, expected, `CHECK ${m[1]} must equal the registry`);
      checkCount += 1;
    }
  }
  // links + mirror + equivalence(a,b) + merge_log(primary,secondary) + spine cache = 7
  assert.equal(checkCount, 7, `expected 7 discriminator-domain CHECKs, saw ${checkCount}`);
});
