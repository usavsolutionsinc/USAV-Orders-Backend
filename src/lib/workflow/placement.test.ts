/**
 * placement — the action-layer resolver that maps a decision node's symbolic
 * placement to a concrete bin. Proves barcode-first-then-name precedence, the
 * degrade misses (no directive / bin not found), and that resolution never
 * throws — all DB-free via injected lookups.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlacementBin, type PlacementResolverDeps } from './placement';
import type { DecisionPlacement } from './decision-eval';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 1 as unknown as OrgId;

/** A fakes factory that captures lookups and returns scripted bins. */
function fakes(
  byBarcode: Record<string, { id: number; name: string }> = {},
  byName: Record<string, { id: number; name: string }> = {},
): { deps: PlacementResolverDeps; calls: { barcode: string[]; name: string[] } } {
  const calls = { barcode: [] as string[], name: [] as string[] };
  return {
    calls,
    deps: {
      findByBarcode: async (b) => {
        calls.barcode.push(b);
        return byBarcode[b] ?? null;
      },
      findByName: async (n) => {
        calls.name.push(n);
        return byName[n] ?? null;
      },
    },
  };
}

test('resolves a placement symbol by barcode first', async () => {
  const { deps, calls } = fakes({ 'TECH-PARTS': { id: 42, name: 'Tech Parts' } });
  const placement: DecisionPlacement = { placement: 'TECH-PARTS', category: 'parts' };
  const result = await resolvePlacementBin(placement, ORG, deps);
  assert.deepEqual(result, { resolved: true, bin: { binId: 42, binName: 'Tech Parts' } });
  assert.deepEqual(calls.barcode, ['TECH-PARTS']);
  assert.deepEqual(calls.name, []); // name lookup short-circuited
});

test('falls back to a name lookup when the barcode lookup misses', async () => {
  const { deps, calls } = fakes({}, { 'Tech Parts': { id: 7, name: 'Tech Parts' } });
  const result = await resolvePlacementBin({ placement: 'Tech Parts' }, ORG, deps);
  assert.deepEqual(result, { resolved: true, bin: { binId: 7, binName: 'Tech Parts' } });
  assert.deepEqual(calls.barcode, ['Tech Parts']);
  assert.deepEqual(calls.name, ['Tech Parts']); // fell through to name
});

test('a route-only rule (placement null) misses with no_directive — no lookup fired', async () => {
  const { deps, calls } = fakes({ 'X': { id: 1, name: 'X' } });
  assert.deepEqual(await resolvePlacementBin(null, ORG, deps), {
    resolved: false,
    reason: 'no_directive',
  });
  assert.deepEqual(calls.barcode, []);
  assert.deepEqual(calls.name, []);
});

test('an empty / whitespace placement symbol is treated as no_directive', async () => {
  const { deps } = fakes();
  assert.deepEqual(await resolvePlacementBin({ placement: '   ' }, ORG, deps), {
    resolved: false,
    reason: 'no_directive',
  });
  assert.deepEqual(await resolvePlacementBin({ category: 'parts' }, ORG, deps), {
    resolved: false,
    reason: 'no_directive',
  });
});

test('an unseeded bin degrades to bin_not_found rather than throwing', async () => {
  const { deps } = fakes(); // nothing seeded
  assert.deepEqual(await resolvePlacementBin({ placement: 'MISSING-BIN' }, ORG, deps), {
    resolved: false,
    reason: 'bin_not_found',
  });
});
