import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabel, resolveKind, buildStateMeta } from './resolve';
import { LABEL_DEFAULTS, TONE_CLASSES } from './registry';

test('default resolution returns the seeded label + tone classes', () => {
  const r = resolveLabel('unshipped', 'PENDING');
  assert.equal(r.label, 'Pending');
  assert.equal(r.tone, 'yellow');
  assert.equal(r.source, 'default');
  assert.equal(r.pill, 'bg-yellow-50 text-yellow-700 ring-yellow-200');
  assert.equal(r.dot, 'bg-yellow-500');
});

test('org override wins over the default and flips source to org', () => {
  const ctx = { overrides: { unshipped: { PENDING: { label: 'QC Queue', tone: 'indigo' as const } } } };
  const r = resolveLabel('unshipped', 'PENDING', ctx);
  assert.equal(r.label, 'QC Queue'); // tenant text
  assert.equal(r.tone, 'indigo'); // tenant tone
  assert.equal(r.dot, 'bg-indigo-500'); // resolved from the overridden tone
  assert.equal(r.source, 'org');
  assert.equal(r.code, 'PENDING'); // stable code is NEVER overridden
});

test('a partial override keeps the unset fields at their default', () => {
  const ctx = { overrides: { unshipped: { TESTED: { label: 'Passed QC' } } } };
  const r = resolveLabel('unshipped', 'TESTED', ctx);
  assert.equal(r.label, 'Passed QC');
  assert.equal(r.tone, 'teal'); // untouched default
});

test('unknown code degrades to a neutral slate chip, never throws', () => {
  const r = resolveLabel('unshipped', 'NOT_A_REAL_CODE');
  assert.equal(r.label, 'NOT_A_REAL_CODE');
  assert.equal(r.tone, 'slate');
});

test('PACKED_STAGED is the shared seam — identical dot hue across both kinds', () => {
  const u = resolveLabel('unshipped', 'PACKED_STAGED');
  const o = resolveLabel('outbound', 'PACKED_STAGED');
  assert.equal(u.dot, o.dot); // same amber dot = the locked seam
  assert.notEqual(u.label, o.label); // but distinct labels ('Packed · Staged' vs 'In Staging')
});

test('no two status dots share a hue (except the PACKED_STAGED seam)', () => {
  const dots: string[] = [];
  for (const kind of ['unshipped', 'outbound'] as const) {
    for (const code of Object.keys(LABEL_DEFAULTS[kind])) {
      dots.push(resolveLabel(kind, code).dot);
    }
  }
  // 5 unshipped + 7 outbound = 12 entries, minus the 1 shared seam = 11 distinct.
  assert.equal(new Set(dots).size, 11);
});

test('every tone token maps to a pill + dot class pair', () => {
  for (const tone of Object.keys(TONE_CLASSES) as Array<keyof typeof TONE_CLASSES>) {
    assert.match(TONE_CLASSES[tone].pill, /^bg-\w+-50 text-\w+-\d+ ring-\w+-200$/);
    assert.match(TONE_CLASSES[tone].dot, /^bg-\w+-\d+$/);
  }
});

test('buildStateMeta exposes the legacy {label,description,pill,dot} shape for every code', () => {
  const meta = buildStateMeta('outbound');
  assert.equal(Object.keys(meta).length, 7);
  for (const code of Object.keys(LABEL_DEFAULTS.outbound)) {
    const m = meta[code];
    assert.ok(m.label && m.description && m.pill && m.dot);
  }
});

test('resolveKind returns every code of a kind in seed order', () => {
  assert.deepEqual(
    resolveKind('outbound').map((r) => r.code),
    ['PACKED_STAGED', 'SCANNED_OUT', 'IN_CUSTODY', 'DELIVERED', 'EXCEPTION', 'PROCESS_GAP', 'ORPHAN'],
  );
});
