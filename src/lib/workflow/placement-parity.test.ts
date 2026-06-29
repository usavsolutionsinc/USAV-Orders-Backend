/**
 * placement-parity — the observe-only parity shim. Proves the verdicts
 * (match / divergence / unseeded / bin_not_found), the off-by-default gate, and
 * that the observer never throws — all DB-free via injected resolver deps + an
 * injected log sink.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observePlacementParity,
  type PlacementParityLog,
} from './placement-parity';
import type { PlacementResolverDeps } from './placement';
import type { DecisionRule } from './decision-eval';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 1 as unknown as OrgId;

const PARTS_POLICY: DecisionRule[] = [
  { id: 'parts', when: { disposition: 'parts' }, thenPort: 'parts', then: { placement: 'TECH-PARTS', category: 'parts' } },
];

function binDeps(byBarcode: Record<string, { id: number; name: string }>): PlacementResolverDeps {
  return {
    findByBarcode: async (b) => byBarcode[b] ?? null,
    findByName: async () => null,
  };
}

/** Capture-the-last-log sink + run the observer with the flag forced on. */
async function observe(input: Parameters<typeof observePlacementParity>[0]): Promise<PlacementParityLog | null> {
  const prev = process.env.PLACEMENT_PARITY_OBSERVE;
  process.env.PLACEMENT_PARITY_OBSERVE = 'true';
  let captured: PlacementParityLog | null = null;
  try {
    await observePlacementParity({ ...input, log: (e) => (captured = e) });
  } finally {
    if (prev === undefined) delete process.env.PLACEMENT_PARITY_OBSERVE;
    else process.env.PLACEMENT_PARITY_OBSERVE = prev;
  }
  return captured;
}

test('match: the mechanism resolves the same bin the live path used', async () => {
  const log = await observe({
    site: 'parts-sort',
    orgId: ORG,
    facts: { disposition: 'parts' },
    rules: PARTS_POLICY,
    expected: { binId: 42, binName: 'Tech Parts' },
    deps: binDeps({ 'TECH-PARTS': { id: 42, name: 'Tech Parts' } }),
  });
  assert.equal(log?.verdict, 'match');
  assert.equal(log?.resolvedBinId, 42);
  assert.equal(log?.expectedBinId, 42);
  assert.equal(log?.placement, 'TECH-PARTS');
});

test('divergence: the mechanism resolves a DIFFERENT bin than the live path', async () => {
  const log = await observe({
    site: 'parts-sort',
    orgId: ORG,
    facts: { disposition: 'parts' },
    rules: PARTS_POLICY,
    expected: { binId: 99, binName: 'Old Parts' }, // live used 99…
    deps: binDeps({ 'TECH-PARTS': { id: 42, name: 'Tech Parts' } }), // …mechanism resolves 42
  });
  assert.equal(log?.verdict, 'divergence');
  assert.equal(log?.expectedBinId, 99);
  assert.equal(log?.resolvedBinId, 42);
});

test('decision_layer_unseeded: no rule carries a placement for these facts', async () => {
  const log = await observe({
    site: 'parts-sort',
    orgId: ORG,
    facts: { disposition: 'something-else' }, // policy only matches disposition:parts
    rules: PARTS_POLICY,
    expected: { binId: 42, binName: 'Tech Parts' },
    deps: binDeps({ 'TECH-PARTS': { id: 42, name: 'Tech Parts' } }),
  });
  assert.equal(log?.verdict, 'decision_layer_unseeded');
  assert.equal(log?.resolvedBinId, null);
});

test('bin_not_found: a placement matched but its symbol resolves to no seeded bin', async () => {
  const log = await observe({
    site: 'parts-sort',
    orgId: ORG,
    facts: { disposition: 'parts' },
    rules: PARTS_POLICY,
    expected: { binId: 42, binName: 'Tech Parts' },
    deps: binDeps({}), // TECH-PARTS not seeded
  });
  assert.equal(log?.verdict, 'bin_not_found');
  assert.equal(log?.resolvedBinId, null);
});

test('off by default: no log fires unless PLACEMENT_PARITY_OBSERVE is on', async () => {
  const prev = process.env.PLACEMENT_PARITY_OBSERVE;
  delete process.env.PLACEMENT_PARITY_OBSERVE;
  let fired = false;
  try {
    await observePlacementParity({
      site: 'parts-sort',
      orgId: ORG,
      facts: { disposition: 'parts' },
      rules: PARTS_POLICY,
      expected: { binId: 42, binName: 'Tech Parts' },
      deps: binDeps({ 'TECH-PARTS': { id: 42, name: 'Tech Parts' } }),
      log: () => (fired = true),
    });
  } finally {
    if (prev !== undefined) process.env.PLACEMENT_PARITY_OBSERVE = prev;
  }
  assert.equal(fired, false);
});

test('never throws: a resolver that rejects is swallowed (no log, no throw)', async () => {
  const prev = process.env.PLACEMENT_PARITY_OBSERVE;
  process.env.PLACEMENT_PARITY_OBSERVE = 'true';
  let logged = false;
  try {
    await observePlacementParity({
      site: 'parts-sort',
      orgId: ORG,
      facts: { disposition: 'parts' },
      rules: PARTS_POLICY,
      expected: { binId: 42, binName: 'Tech Parts' },
      deps: {
        findByBarcode: async () => {
          throw new Error('db down');
        },
        findByName: async () => null,
      },
      log: () => (logged = true),
    });
  } finally {
    if (prev === undefined) delete process.env.PLACEMENT_PARITY_OBSERVE;
    else process.env.PLACEMENT_PARITY_OBSERVE = prev;
  }
  assert.equal(logged, false); // error path skipped the log, but did not throw
});
