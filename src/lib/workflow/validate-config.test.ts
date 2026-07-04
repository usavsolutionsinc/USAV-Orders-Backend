/**
 * DB-free tests for the node-config validator (validate-config.ts).
 * Importing the @/lib/workflow barrel registers the builtin nodes. All the
 * station-style process nodes (inspection/pack/ship/…) share the station
 * configSchema (slaHours/station/trigger); `decision` has its own
 * (outputs/rules/defaultPort). test-db-url must load first (the barrel needs a
 * well-formed DATABASE_URL at import; no query runs).
 * Run: npm run test:assistant
 */

import '@/lib/assistant/test-db-url'; // MUST be first
import '@/lib/workflow'; // registers builtin nodes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNodeConfig } from './validate-config';

test('station-schema node: a fully-valid config passes', () => {
  const r = validateNodeConfig('inspection', { slaHours: 24, station: 'TECH', trigger: 'scan' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('station-schema node: wrong type for a declared property is rejected', () => {
  const r = validateNodeConfig('inspection', { slaHours: 'later' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /config\.slaHours must be a number/);
});

test('station-schema node: an off-enum value (trigger not in options) is rejected', () => {
  const r = validateNodeConfig('pack', { trigger: 'banner' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /config\.trigger must be one of: scan, feed/);
});

test('decision: an array property given a scalar is rejected', () => {
  const r = validateNodeConfig('decision', { rules: 'nope' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /config\.rules must be a array/);
});

test('decision: a string property given a number is rejected', () => {
  const r = validateNodeConfig('decision', { defaultPort: 123 });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /config\.defaultPort must be a string/);
});

test('decision: valid arrays + default port pass', () => {
  const r = validateNodeConfig('decision', { outputs: [], rules: [], defaultPort: 'hold' });
  assert.equal(r.ok, true);
});

test('an unknown node type is not rejected here (type validity is enforced elsewhere)', () => {
  const r = validateNodeConfig('totally_made_up', { slaHours: 'x', trigger: 'nope' });
  assert.equal(r.ok, true);
});

test('omitted and null-valued properties are allowed (schemas have no `required`)', () => {
  assert.equal(validateNodeConfig('inspection', {}).ok, true);
  assert.equal(validateNodeConfig('inspection', { slaHours: null }).ok, true);
  assert.equal(validateNodeConfig('inspection', { station: undefined }).ok, true);
});

test('extra keys not declared in the schema are allowed (no additionalProperties:false)', () => {
  const r = validateNodeConfig('inspection', { slaHours: 8, somethingCustom: { a: 1 } });
  assert.equal(r.ok, true);
});

test('multiple violations are all collected', () => {
  const r = validateNodeConfig('pack', { slaHours: 'x', trigger: 'nope' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
});
