/**
 * DB-free unit tests for mergeAccounts() — the account-fold logic.
 *
 * Run: npx tsx --test src/lib/identity/accounts.test.ts
 *
 * Uses the Deps-injection pattern: a fakes() factory captures every collaborator
 * call so we assert on both the return value and what the fold threaded into the
 * injected deps — with zero database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAccounts,
  AccountMergeError,
  type MergeAccountsDeps,
  type MergeAccountSnapshot,
} from './accounts';

const SURVIVOR = '11111111-1111-1111-1111-111111111111';
const MERGED = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const ORG = 'org-test';

interface Capture {
  repointMemberships: Array<[string, string]>;
  repointStaff: Array<[string, string]>;
  repointIdentities: Array<[string, string]>;
  repointPasskeys: Array<[string, string]>;
  markMerged: Array<[string, string]>;
}

function fakes(opts: {
  accounts: Record<string, MergeAccountSnapshot>;
  emails: Record<string, string[]>;
  counts?: Partial<Record<'memberships' | 'staff' | 'identities' | 'passkeys', number>>;
}): { deps: MergeAccountsDeps; capture: Capture } {
  const capture: Capture = {
    repointMemberships: [],
    repointStaff: [],
    repointIdentities: [],
    repointPasskeys: [],
    markMerged: [],
  };
  const c = opts.counts ?? {};
  const deps: MergeAccountsDeps = {
    async loadAccount(id) {
      return opts.accounts[id] ?? null;
    },
    async listVerifiedEmails(id) {
      return opts.emails[id] ?? [];
    },
    async repointMemberships(from, to) {
      capture.repointMemberships.push([from, to]);
      return c.memberships ?? 0;
    },
    async repointStaff(from, to) {
      capture.repointStaff.push([from, to]);
      return c.staff ?? 0;
    },
    async repointIdentities(from, to) {
      capture.repointIdentities.push([from, to]);
      return c.identities ?? 0;
    },
    async repointPasskeys(from, to) {
      capture.repointPasskeys.push([from, to]);
      return c.passkeys ?? 0;
    },
    async markMerged(mergedId, survivorId) {
      capture.markMerged.push([mergedId, survivorId]);
    },
    async transaction(_orgId, fn) {
      // The real impl wraps withTenantTransaction; the fake just runs the body.
      return fn(null as never);
    },
  };
  return { deps, capture };
}

const active = (id: string): MergeAccountSnapshot => ({
  id,
  status: 'active',
  deletedAt: null,
  mergedInto: null,
});

test('mergeAccounts re-points all four relations and soft-marks the merged account', async () => {
  const { deps, capture } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR), [MERGED]: active(MERGED) },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: ['sam@example.com'] },
    counts: { memberships: 2, staff: 3, identities: 1, passkeys: 4 },
  });

  const result = await mergeAccounts(
    { survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG },
    deps,
  );

  assert.equal(result.idempotent, false);
  assert.deepEqual(result.repointed, { memberships: 2, staff: 3, identities: 1, passkeys: 4 });

  // All four relations re-pointed merged -> survivor, exactly once each.
  assert.deepEqual(capture.repointMemberships, [[MERGED, SURVIVOR]]);
  assert.deepEqual(capture.repointStaff, [[MERGED, SURVIVOR]]);
  assert.deepEqual(capture.repointIdentities, [[MERGED, SURVIVOR]]);
  assert.deepEqual(capture.repointPasskeys, [[MERGED, SURVIVOR]]);
  // Merged account soft-marked into survivor.
  assert.deepEqual(capture.markMerged, [[MERGED, SURVIVOR]]);
});

test('mergeAccounts matches verified emails case-insensitively', async () => {
  const { deps, capture } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR), [MERGED]: active(MERGED) },
    emails: { [SURVIVOR]: ['Sam@Example.COM'], [MERGED]: ['sam@example.com'] },
  });
  const result = await mergeAccounts(
    { survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG },
    deps,
  );
  assert.equal(result.idempotent, false);
  assert.equal(capture.markMerged.length, 1);
});

test('mergeAccounts refuses when the accounts share no verified email', async () => {
  const { deps, capture } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR), [MERGED]: active(MERGED) },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: ['different@example.com'] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps),
    (err) => err instanceof AccountMergeError && err.code === 'EMAIL_MISMATCH',
  );
  // Nothing was re-pointed on a refused merge.
  assert.equal(capture.repointMemberships.length, 0);
  assert.equal(capture.markMerged.length, 0);
});

test('mergeAccounts refuses when an account has no verified email', async () => {
  const { deps } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR), [MERGED]: active(MERGED) },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: [] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps),
    (err) => err instanceof AccountMergeError && err.code === 'MERGED_NO_VERIFIED_EMAIL',
  );

  const { deps: deps2 } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR), [MERGED]: active(MERGED) },
    emails: { [SURVIVOR]: [], [MERGED]: ['sam@example.com'] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps2),
    (err) => err instanceof AccountMergeError && err.code === 'SURVIVOR_NO_VERIFIED_EMAIL',
  );
});

test('mergeAccounts is idempotent — a re-run after a fold is a no-op', async () => {
  const { deps, capture } = fakes({
    accounts: {
      [SURVIVOR]: active(SURVIVOR),
      // Already folded into the survivor.
      [MERGED]: { id: MERGED, status: 'merged', deletedAt: '2026-06-29', mergedInto: SURVIVOR },
    },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: ['sam@example.com'] },
    counts: { memberships: 2, staff: 3, identities: 1, passkeys: 4 },
  });

  const result = await mergeAccounts(
    { survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG },
    deps,
  );

  assert.equal(result.idempotent, true);
  assert.deepEqual(result.repointed, { memberships: 0, staff: 0, identities: 0, passkeys: 0 });
  // No relation touched, no re-mark on the idempotent path.
  assert.equal(capture.repointMemberships.length, 0);
  assert.equal(capture.repointStaff.length, 0);
  assert.equal(capture.repointIdentities.length, 0);
  assert.equal(capture.repointPasskeys.length, 0);
  assert.equal(capture.markMerged.length, 0);
});

test('mergeAccounts refuses to re-fold an account into a DIFFERENT survivor', async () => {
  const { deps } = fakes({
    accounts: {
      [SURVIVOR]: active(SURVIVOR),
      [MERGED]: { id: MERGED, status: 'merged', deletedAt: '2026-06-29', mergedInto: OTHER },
    },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: ['sam@example.com'] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps),
    (err) => err instanceof AccountMergeError && err.code === 'MERGED_INTO_OTHER',
  );
});

test('mergeAccounts refuses when the survivor is not active', async () => {
  const { deps } = fakes({
    accounts: {
      [SURVIVOR]: { id: SURVIVOR, status: 'suspended', deletedAt: null, mergedInto: null },
      [MERGED]: active(MERGED),
    },
    emails: { [SURVIVOR]: ['sam@example.com'], [MERGED]: ['sam@example.com'] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps),
    (err) => err instanceof AccountMergeError && err.code === 'SURVIVOR_INACTIVE',
  );
});

test('mergeAccounts rejects self-merge and missing accounts', async () => {
  const { deps } = fakes({ accounts: {}, emails: {} });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: SURVIVOR, orgId: ORG }, deps),
    (err) => err instanceof AccountMergeError && err.code === 'SAME_ACCOUNT',
  );

  const { deps: deps2 } = fakes({
    accounts: { [MERGED]: active(MERGED) },
    emails: {},
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps2),
    (err) => err instanceof AccountMergeError && err.code === 'SURVIVOR_NOT_FOUND',
  );

  const { deps: deps3 } = fakes({
    accounts: { [SURVIVOR]: active(SURVIVOR) },
    emails: { [SURVIVOR]: ['sam@example.com'] },
  });
  await assert.rejects(
    () => mergeAccounts({ survivorAccountId: SURVIVOR, mergedAccountId: MERGED, orgId: ORG }, deps3),
    (err) => err instanceof AccountMergeError && err.code === 'MERGED_NOT_FOUND',
  );
});
