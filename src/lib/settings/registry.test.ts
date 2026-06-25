/**
 * Guard test for the Settings Registry — mirrors permission-registry.test.ts.
 * Run with the repo's node:test + tsx runner. Every invariant the framework
 * relies on (unique page-namespaced keys, a default on every schema, options
 * present where the control needs them, sane entitlement/scope pairings) is
 * asserted here so a malformed row can't slip in unreviewed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, SETTING_PAGES, settingByKey } from './registry';
import { settingDefault } from './resolve';

test('registry: keys are unique', () => {
  const seen = new Set<string>();
  for (const s of SETTINGS) {
    assert.equal(seen.has(s.key), false, `duplicate key ${s.key}`);
    seen.add(s.key);
  }
});

test('registry: keys are page-namespaced', () => {
  for (const s of SETTINGS) {
    assert.ok(s.key.startsWith(`${s.page}.`), `key ${s.key} must start with its page id`);
  }
});

test('registry: every page is declared', () => {
  const pages = new Set(SETTING_PAGES.map((p) => p.id));
  for (const s of SETTINGS) {
    assert.ok(pages.has(s.page), `setting ${s.key} uses undeclared page ${s.page}`);
  }
});

test('registry: labels are non-empty and trimmed', () => {
  for (const s of SETTINGS) {
    assert.ok(s.label.length > 0, `empty label for ${s.key}`);
    assert.equal(s.label, s.label.trim(), `untrimmed label for ${s.key}`);
  }
});

test('registry: every schema declares a default', () => {
  for (const s of SETTINGS) {
    const r = s.schema.safeParse(undefined);
    assert.ok(r.success, `setting ${s.key} schema must have a .default()`);
    // settingDefault must therefore return something other than undefined.
    assert.notEqual(settingDefault(s), undefined, `setting ${s.key} default resolves to undefined`);
  }
});

test('registry: segmented/select declare >=2 options', () => {
  for (const s of SETTINGS) {
    if (s.control === 'segmented' || s.control === 'select') {
      assert.ok(s.options && s.options.length >= 2, `${s.key} (${s.control}) needs >=2 options`);
    }
  }
});

test('registry: option defaults parse against the schema', () => {
  for (const s of SETTINGS) {
    for (const opt of s.options ?? []) {
      assert.ok(s.schema.safeParse(opt.value).success, `${s.key} option ${String(opt.value)} fails its schema`);
    }
  }
});

test('registry: optionEntitlements reference real options', () => {
  for (const s of SETTINGS) {
    if (!s.optionEntitlements) continue;
    const optionValues = new Set((s.options ?? []).map((o) => String(o.value)));
    for (const val of Object.keys(s.optionEntitlements)) {
      assert.ok(optionValues.has(val), `${s.key} optionEntitlements names unknown option ${val}`);
    }
  }
});

test('registry: personalizable implies org scope', () => {
  for (const s of SETTINGS) {
    if (s.personalizable) assert.equal(s.scope, 'org', `${s.key} personalizable must be org scope`);
  }
});

test('registry: org-scope settings declare a write permission', () => {
  for (const s of SETTINGS) {
    if (s.scope === 'org') assert.ok(s.permission, `${s.key} (org) must declare a permission`);
  }
});

test('registry: staff-scope settings declare no permission/entitlement', () => {
  for (const s of SETTINGS) {
    if (s.scope === 'staff') {
      assert.equal(s.permission, undefined, `${s.key} (staff) must not declare a permission`);
      assert.equal(s.entitlement, undefined, `${s.key} (staff) must not be entitlement-gated`);
    }
  }
});

test('settingByKey round-trips for every entry', () => {
  for (const s of SETTINGS) assert.equal(settingByKey(s.key)?.key, s.key);
});
