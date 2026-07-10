/**
 * Webhook org resolver — fail-closed decision logic, DB-free via injected deps.
 *
 * The invariant under test: a session-less webhook may only ever write under
 * an org the payload provably belongs to. Anything ambiguous (2+ candidate
 * orgs) or unknown resolves to null — the caller skips the event.
 */

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import {
  resolveWebhookOrgByTracking,
  resolveWebhookOrgForSquareMerchant,
  type WebhookOrgResolverDeps,
} from './webhook-org-resolver';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type Row = { organization_id: string | null; scope?: string | null };

/**
 * Build deps whose query fn dispatches on the table named in the SQL, and
 * capture every warn + query so tests can assert on what was threaded in.
 */
function fakes(rowsByTable: {
  stn?: Row[];
  orders?: Row[];
  integrations?: Row[];
} = {}) {
  const warns: Array<{ message: string; meta: Record<string, unknown> }> = [];
  const queries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
  const deps: WebhookOrgResolverDeps = {
    query: async (text, params) => {
      queries.push({ text, params });
      if (text.includes('organization_integrations')) return { rows: rowsByTable.integrations ?? [] };
      if (text.includes('JOIN shipping_tracking_numbers')) return { rows: rowsByTable.orders ?? [] };
      return { rows: rowsByTable.stn ?? [] };
    },
    warn: (message, meta) => warns.push({ message, meta }),
  };
  return { deps, warns, queries };
}

// ─── resolveWebhookOrgByTracking ──────────────────────────────────────────────

test('tracking: resolves the org from the registration table', async () => {
  const { deps, warns, queries } = fakes({ stn: [{ organization_id: ORG_A }] });
  const org = await resolveWebhookOrgByTracking('1Z999AA10123456784', deps);
  strictEqual(org, ORG_A);
  strictEqual(warns.length, 0);
  // Registration hit → the orders fallback query never fires.
  strictEqual(queries.length, 1);
});

test('tracking: normalizes the number before looking it up', async () => {
  const { deps, queries } = fakes({ stn: [{ organization_id: ORG_A }] });
  await resolveWebhookOrgByTracking('  1z999aa10123456784  ', deps);
  deepStrictEqual(queries[0].params, ['1Z999AA10123456784']);
});

test('tracking: ambiguous (2 owning orgs) → null + warn, no fallback guess', async () => {
  const { deps, warns } = fakes({
    stn: [{ organization_id: ORG_A }, { organization_id: ORG_B }],
    orders: [{ organization_id: ORG_A }],
  });
  const org = await resolveWebhookOrgByTracking('1Z999AA10123456784', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 1);
  ok(warns[0].message.includes('ambiguous tracking'));
});

test('tracking: unstamped registration row falls back to the linked order org', async () => {
  const { deps, warns } = fakes({ stn: [], orders: [{ organization_id: ORG_B }] });
  const org = await resolveWebhookOrgByTracking('1Z999AA10123456784', deps);
  strictEqual(org, ORG_B);
  strictEqual(warns.length, 0);
});

test('tracking: ambiguous linked orders → null + warn', async () => {
  const { deps, warns } = fakes({
    orders: [{ organization_id: ORG_A }, { organization_id: ORG_B }],
  });
  const org = await resolveWebhookOrgByTracking('1Z999AA10123456784', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 1);
});

test('tracking: completely unknown number → null', async () => {
  const { deps, warns } = fakes();
  const org = await resolveWebhookOrgByTracking('1Z999AA10123456784', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 0);
});

test('tracking: empty input → null without querying', async () => {
  const { deps, queries } = fakes();
  const org = await resolveWebhookOrgByTracking('   ', deps);
  strictEqual(org, null);
  strictEqual(queries.length, 0);
});

// ─── resolveWebhookOrgForSquareMerchant ──────────────────────────────────────

test('square: exact scope match wins over a NULL-scope connection', async () => {
  const { deps } = fakes({
    integrations: [
      { organization_id: ORG_A, scope: 'MERCHANT_1' },
      { organization_id: ORG_B, scope: null },
    ],
  });
  const org = await resolveWebhookOrgForSquareMerchant('MERCHANT_1', deps);
  strictEqual(org, ORG_A);
});

test('square: single NULL-scope connection resolves (common single-account case)', async () => {
  const { deps } = fakes({ integrations: [{ organization_id: ORG_B, scope: null }] });
  const org = await resolveWebhookOrgForSquareMerchant('MERCHANT_1', deps);
  strictEqual(org, ORG_B);
});

test('square: two exact-scope orgs is ambiguous → null + warn (never falls back to NULL-scope)', async () => {
  const { deps, warns } = fakes({
    integrations: [
      { organization_id: ORG_A, scope: 'MERCHANT_1' },
      { organization_id: ORG_B, scope: 'MERCHANT_1' },
      { organization_id: ORG_B, scope: null },
    ],
  });
  const org = await resolveWebhookOrgForSquareMerchant('MERCHANT_1', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 1);
  ok(warns[0].message.includes('ambiguous square merchant'));
});

test('square: two NULL-scope orgs is ambiguous → null + warn', async () => {
  const { deps, warns } = fakes({
    integrations: [
      { organization_id: ORG_A, scope: null },
      { organization_id: ORG_B, scope: null },
    ],
  });
  const org = await resolveWebhookOrgForSquareMerchant('MERCHANT_1', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 1);
  ok(warns[0].message.includes('ambiguous square merchant'));
});

test('square: no mapping row → null', async () => {
  const { deps, warns } = fakes();
  const org = await resolveWebhookOrgForSquareMerchant('MERCHANT_1', deps);
  strictEqual(org, null);
  strictEqual(warns.length, 0);
});

test('square: blank merchant id → null without querying', async () => {
  const { deps, queries } = fakes();
  const org = await resolveWebhookOrgForSquareMerchant('  ', deps);
  strictEqual(org, null);
  strictEqual(queries.length, 0);
});
