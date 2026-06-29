/**
 * placement-policy — per-org placement resolution from the Studio graph. Proves
 * org rules win over the system default, the system default is the fallback,
 * route-only org rules don't shadow the default, and a read fault degrades to
 * the default — all DB-free via injected policy + bin deps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOrgPlacementRules, resolveSitePlacementBin } from './placement-policy';
import type { PlacementResolverDeps } from './placement';
import type { DecisionRule } from './decision-eval';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 1 as unknown as OrgId;

const SYSTEM_POLICY: DecisionRule[] = [
  { id: 'sys', when: { disposition: 'parts' }, thenPort: 'parts', then: { placement: 'TECH-PARTS', category: 'parts' } },
];

function binDeps(byBarcode: Record<string, { id: number; name: string }>): PlacementResolverDeps {
  return {
    findByBarcode: async (b) => byBarcode[b] ?? null,
    findByName: async (n) => byBarcode[n] ?? null,
  };
}

/** A policy-deps fake that serves the given decision-node configs for the org. */
function policyDeps(configs: Array<Record<string, unknown>>) {
  return { loadActiveDecisionConfigs: async () => configs };
}

test('loadOrgPlacementRules flattens every decision node config into one rule list', async () => {
  const rules = await loadOrgPlacementRules(
    ORG,
    policyDeps([
      { rules: [{ id: 'a', when: { grade: 'A' }, thenPort: 'p', then: { placement: 'A-BIN' } }] },
      { rules: [{ id: 'b', when: { disposition: 'parts' }, thenPort: 'q', then: { placement: 'ORG-PARTS' } }] },
    ]),
  );
  assert.equal(rules.length, 2);
  assert.equal(rules[1].then?.placement, 'ORG-PARTS');
});

test('org policy wins over the system default for the same facts', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'parts' },
    systemPolicy: SYSTEM_POLICY,
    policyDeps: policyDeps([
      { rules: [{ id: 'org', when: { disposition: 'parts' }, thenPort: 'q', then: { placement: 'ORG-PARTS' } }] },
    ]),
    binDeps: binDeps({ 'ORG-PARTS': { id: 7, name: 'Org Parts' }, 'TECH-PARTS': { id: 1, name: 'Sys Parts' } }),
  });
  assert.deepEqual(result, { bin: { binId: 7, binName: 'Org Parts' }, source: 'org' });
});

test('falls back to the system default when the org has no matching rule', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'parts' },
    systemPolicy: SYSTEM_POLICY,
    policyDeps: policyDeps([]), // no decision nodes
    binDeps: binDeps({ 'TECH-PARTS': { id: 1, name: 'Sys Parts' } }),
  });
  assert.deepEqual(result, { bin: { binId: 1, binName: 'Sys Parts' }, source: 'system' });
});

test('a route-only org rule (no placement) does not shadow the system default', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'parts' },
    systemPolicy: SYSTEM_POLICY,
    // org rule matches the facts but carries NO placement → must not block the default
    policyDeps: policyDeps([{ rules: [{ id: 'org', when: { disposition: 'parts' }, thenPort: 'q' }] }]),
    binDeps: binDeps({ 'TECH-PARTS': { id: 1, name: 'Sys Parts' } }),
  });
  assert.deepEqual(result, { bin: { binId: 1, binName: 'Sys Parts' }, source: 'system' });
});

test('returns null when neither layer resolves a bin (caller degrades to legacy)', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'parts' },
    systemPolicy: SYSTEM_POLICY,
    policyDeps: policyDeps([]),
    binDeps: binDeps({}), // TECH-PARTS not seeded
  });
  assert.equal(result, null);
});

test('empty system policy + matching org rule resolves the org bin (opt-in RMA-restock shape)', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'ACCEPT' },
    systemPolicy: [], // no built-in default — purely opt-in
    policyDeps: policyDeps([
      { rules: [{ id: 'org', when: { disposition: 'ACCEPT' }, thenPort: 'restock', then: { placement: 'RESTOCK-1' } }] },
    ]),
    binDeps: binDeps({ 'RESTOCK-1': { id: 9, name: 'Restock 1' } }),
  });
  assert.deepEqual(result, { bin: { binId: 9, binName: 'Restock 1' }, source: 'org' });
});

test('empty system policy + no org rule → null (opt-in stays bin-less)', async () => {
  const result = await resolveSitePlacementBin({
    orgId: ORG,
    facts: { disposition: 'ACCEPT' },
    systemPolicy: [],
    policyDeps: policyDeps([]),
    binDeps: binDeps({ 'RESTOCK-1': { id: 9, name: 'Restock 1' } }),
  });
  assert.equal(result, null);
});

test('a policy read fault degrades to [] (and thus to the system default)', async () => {
  const rules = await loadOrgPlacementRules(ORG, {
    loadActiveDecisionConfigs: async () => {
      throw new Error('db down');
    },
  });
  assert.deepEqual(rules, []);
});
