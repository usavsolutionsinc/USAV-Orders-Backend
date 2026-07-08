import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Speed-first regression lock (docs/todo · "Unfound carton: speed-first scan").
 *
 * The scan path must never ping an integration mid-scan. The unfound-carton open
 * (`applyUnmatchedCarton`) used to fire a background `POST /api/receiving/lookup-po`
 * (no localOnly) whenever the localOnly response came back `zoho_pending`, to
 * self-promote the carton against Zoho. That was retired: live Zoho re-checks are
 * now operator-initiated only (UnfoundMatchStrip), with the reconcile cron as the
 * passive backstop.
 *
 * These are source guards — behaviourally asserting "no second lookup-po on the
 * scan path" would require standing up the whole effectful React/query layer; a
 * source lock is the cheap, robust way to prevent the ping from creeping back.
 */
const SRC = readFileSync(fileURLToPath(new URL('./scan-apply.ts', import.meta.url)), 'utf8');

// Strip comments so the guard asserts on real CODE only — the explanatory
// comments legitimately name `lookup-po` / `zoho_pending` to record why they were
// removed, and shouldn't trip the lock.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('scan-apply issues no lookup-po call (the only one was the retired background ping)', () => {
  assert.equal(
    CODE.includes('lookup-po'),
    false,
    'scan-apply.ts must not call /api/receiving/lookup-po — that was the retired mid-scan integration ping',
  );
});

test('scan-apply does not branch on zoho_pending to fire a background promote', () => {
  assert.equal(
    CODE.includes('zoho_pending'),
    false,
    'scan-apply.ts must not act on zoho_pending — promotion is cron + operator-initiated only',
  );
});
