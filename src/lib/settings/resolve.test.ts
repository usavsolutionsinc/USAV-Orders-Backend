/**
 * Behavior test for the effective-value resolver — the framework's core logic:
 * the org→staff layering, the whole-setting entitlement lock, the per-option
 * lock, and invalid-value fallback. Uses real registry rows + real plan
 * features so the test tracks the actual catalog.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingByKey } from './registry';
import { resolveSetting } from './resolve';
import { entitlementsForPlan } from '../billing/plans';
import type { SettingDef } from './types';

const TRIAL = entitlementsForPlan('trial').features;
const ENTERPRISE = entitlementsForPlan('enterprise').features;

function def(key: string): SettingDef {
  const d = settingByKey(key);
  assert.ok(d, `missing registry key ${key}`);
  return d;
}

test('staff-scope: staff value wins, else default', () => {
  const d = def('receiving.autoFocusSerial'); // toggle, default true
  assert.equal(resolveSetting(d, { orgSettings: {}, staffPrefs: {}, features: ENTERPRISE }).value, true);
  const r = resolveSetting(d, {
    orgSettings: {},
    staffPrefs: { 'receiving.autoFocusSerial': false },
    features: ENTERPRISE,
  });
  assert.equal(r.value, false);
  assert.equal(r.source, 'staff');
});

test('org-scope: org value, else default', () => {
  const d = def('receiving.photoPolicy'); // default 'optional'
  assert.equal(
    resolveSetting(d, { orgSettings: {}, staffPrefs: {}, features: ENTERPRISE }).value,
    'optional',
  );
  const r = resolveSetting(d, {
    orgSettings: { 'receiving.photoPolicy': 'require_one' },
    staffPrefs: {},
    features: ENTERPRISE,
  });
  assert.equal(r.value, 'require_one');
  assert.equal(r.source, 'org');
  assert.equal(r.orgValue, 'require_one');
});

test('org + personalizable: staff override > org > default', () => {
  const d = def('receiving.defaultScanMode'); // org+personalizable, default 'tracking'
  const base = {
    orgSettings: { 'receiving.defaultScanMode': 'order' },
    staffPrefs: {} as Record<string, unknown>,
    features: ENTERPRISE,
  };
  assert.equal(resolveSetting(d, base).value, 'order'); // org default applies
  const overridden = resolveSetting(d, {
    ...base,
    staffPrefs: { 'receiving.defaultScanMode': 'tracking' },
  });
  assert.equal(overridden.value, 'tracking');
  assert.equal(overridden.source, 'staff');
  assert.equal(overridden.orgValue, 'order'); // org default still reported
});

test('whole-setting entitlement lock → free default + locked', () => {
  const d = def('receiving.vision.consensusNeeded'); // entitlement advancedVision, default 2
  const locked = resolveSetting(d, {
    orgSettings: { 'receiving.vision.consensusNeeded': 4 },
    staffPrefs: {},
    features: TRIAL,
  });
  assert.equal(locked.locked, true);
  assert.equal(locked.value, 2); // stored 4 ignored while locked
  assert.equal(locked.source, 'locked');

  const unlocked = resolveSetting(d, {
    orgSettings: { 'receiving.vision.consensusNeeded': 4 },
    staffPrefs: {},
    features: ENTERPRISE,
  });
  assert.equal(unlocked.locked, false);
  assert.equal(unlocked.value, 4);
});

test('per-option lock: option listed + stored locked option falls back', () => {
  const d = def('receiving.nasBackup'); // optionEntitlements.direct = nasArchive
  const noNas = resolveSetting(d, {
    orgSettings: { 'receiving.nasBackup': 'direct' },
    staffPrefs: {},
    features: TRIAL,
  });
  assert.deepEqual(noNas.lockedOptions, ['direct']);
  assert.equal(noNas.value, 'mirror'); // stored 'direct' not usable → default
  assert.equal(noNas.locked, false); // the setting itself isn't fully locked

  const withNas = resolveSetting(d, {
    orgSettings: { 'receiving.nasBackup': 'direct' },
    staffPrefs: {},
    features: ENTERPRISE,
  });
  assert.deepEqual(withNas.lockedOptions, []);
  assert.equal(withNas.value, 'direct');
});

test('invalid stored value falls back to default', () => {
  const d = def('receiving.photoPolicy');
  const r = resolveSetting(d, {
    orgSettings: { 'receiving.photoPolicy': 'bogus' },
    staffPrefs: {},
    features: ENTERPRISE,
  });
  assert.equal(r.value, 'optional');
  assert.equal(r.source, 'default');
});
