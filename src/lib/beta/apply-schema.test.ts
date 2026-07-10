/**
 * DB-free unit tests for the beta-apply validation schema + pure helpers
 * (src/lib/beta/apply-schema.ts). Run: npx tsx --test src/lib/beta/apply-schema.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BetaApplySchema,
  BETA_APPLICATION_STATUSES,
  isBetaApplicationStatus,
  isHoneypotTripped,
  buildPaymentLinkUrl,
} from './apply-schema';

const validApplication = {
  email: 'Owner@Example.COM ',
  companyName: 'Rewind Audio LLC',
  tier: 'application' as const,
  answers: {
    businessType: 'ebay_store',
    monthlyVolume: '100_500',
    stations: ['receiving', 'testing_qc', 'packing'],
    testFailPath: 'part_out',
    salesChannels: ['ebay', 'local_walk_in'],
    channelSplit: { ebay: 80, local_walk_in: 20 },
    currentTools: ['spreadsheets', 'zoho'],
    scansToday: ['tracking', 'serials'],
    teamSize: '2_5',
    conditionGrading: 'ad_hoc',
    conditionGradingDetail: 'A/B/C stickers',
    fixFirst: 'Knowing what is on the testing bench without walking over.',
    noBrainer: 'Zoho import on day one.',
  },
};

test('application tier: full valid payload parses; email is trimmed + lowercased', () => {
  const r = BetaApplySchema.safeParse(validApplication);
  assert.ok(r.success, JSON.stringify(!r.success && r.error.issues));
  assert.equal(r.data.email, 'owner@example.com');
  assert.equal(r.data.tier, 'application');
});

test('application tier: missing required ontology answer (fixFirst) fails', () => {
  const { fixFirst: _omit, ...answers } = validApplication.answers;
  const r = BetaApplySchema.safeParse({ ...validApplication, answers });
  assert.equal(r.success, false);
});

test('application tier: unknown enum value (station) fails', () => {
  const r = BetaApplySchema.safeParse({
    ...validApplication,
    answers: { ...validApplication.answers, stations: ['receiving', 'time_travel'] },
  });
  assert.equal(r.success, false);
});

test('application tier: empty stations array fails (min 1)', () => {
  const r = BetaApplySchema.safeParse({
    ...validApplication,
    answers: { ...validApplication.answers, stations: [] },
  });
  assert.equal(r.success, false);
});

test('application tier: channelSplit percentage out of range fails', () => {
  const r = BetaApplySchema.safeParse({
    ...validApplication,
    answers: { ...validApplication.answers, channelSplit: { ebay: 140 } },
  });
  assert.equal(r.success, false);
});

test('waitlist tier: minimal answers parse; application answers are not required', () => {
  const r = BetaApplySchema.safeParse({
    email: 'lead@example.com',
    tier: 'waitlist',
    answers: { businessType: 'mixed', monthlyVolume: 'under_100', topPain: 'Lost units between benches' },
  });
  assert.ok(r.success, JSON.stringify(!r.success && r.error.issues));
});

test('waitlist tier: application-shaped answers on the waitlist arm fail (topPain required)', () => {
  const r = BetaApplySchema.safeParse({
    email: 'lead@example.com',
    tier: 'waitlist',
    answers: validApplication.answers,
  });
  assert.equal(r.success, false);
});

test('bad email / bad tier rejected', () => {
  assert.equal(BetaApplySchema.safeParse({ ...validApplication, email: 'not-an-email' }).success, false);
  assert.equal(BetaApplySchema.safeParse({ ...validApplication, tier: 'vip' }).success, false);
});

test('honeypot: non-empty hidden website field trips; empty/absent/non-object do not', () => {
  assert.equal(isHoneypotTripped({ ...validApplication, website: 'https://spam.example' }), true);
  assert.equal(isHoneypotTripped({ ...validApplication, website: '  x ' }), true);
  assert.equal(isHoneypotTripped({ ...validApplication, website: '' }), false);
  assert.equal(isHoneypotTripped({ ...validApplication, website: '   ' }), false);
  assert.equal(isHoneypotTripped(validApplication), false);
  assert.equal(isHoneypotTripped(null), false);
  assert.equal(isHoneypotTripped('website=spam'), false);
});

test('schema also rejects a non-empty website field (belt and suspenders)', () => {
  const r = BetaApplySchema.safeParse({ ...validApplication, website: 'https://spam.example' });
  assert.equal(r.success, false);
});

test('buildPaymentLinkUrl appends client_reference_id and preserves existing params', () => {
  const url = buildPaymentLinkUrl('https://buy.stripe.com/test_abc?locale=en', 'app-123');
  assert.ok(url);
  const u = new URL(url!);
  assert.equal(u.searchParams.get('client_reference_id'), 'app-123');
  assert.equal(u.searchParams.get('locale'), 'en');
});

test('buildPaymentLinkUrl returns null on unconfigured or malformed base', () => {
  assert.equal(buildPaymentLinkUrl(undefined, 'app-123'), null);
  assert.equal(buildPaymentLinkUrl(null, 'app-123'), null);
  assert.equal(buildPaymentLinkUrl('', 'app-123'), null);
  assert.equal(buildPaymentLinkUrl('not a url', 'app-123'), null);
});

test('status vocabulary matches the migration CHECK and the guard accepts only it', () => {
  assert.deepEqual(
    [...BETA_APPLICATION_STATUSES],
    ['RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'REFUNDED', 'REJECTED'],
  );
  for (const s of BETA_APPLICATION_STATUSES) assert.equal(isBetaApplicationStatus(s), true);
  assert.equal(isBetaApplicationStatus('paid'), false);
  assert.equal(isBetaApplicationStatus('received'), false);
});
