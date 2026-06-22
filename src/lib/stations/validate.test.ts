/**
 * Unit tests for the station-builder semantic validation + registry lookups
 * (Operations Studio layer 2). These ran against zero coverage before Phase D.
 * Pure / DB-free: validateStationConfig + the registries are all in-memory CODE.
 *
 *   node --import tsx --test src/lib/stations/validate.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { StationConfig } from './contract';
import { validateStationConfig } from './validate';
import {
  getBlock,
  listBlockMeta,
  getDataSource,
  listDataSources,
  getAction,
  actionsForSource,
} from './index';

// ─── Registry lookups (builtins registered on import) ────────────────────────

test('registries: the checklist block + its three builtin sources/actions are registered', () => {
  const checklist = getBlock('checklist');
  assert.ok(checklist, 'checklist block must be registered');
  assert.equal(checklist!.accepts, 'rows');
  assert.deepEqual(checklist!.slots, ['queue']);

  // listBlockMeta drops the lazy `component` thunk (serializable).
  const meta = listBlockMeta().find((b) => b.type === 'checklist');
  assert.ok(meta && !('component' in meta), 'meta must be component-free');

  assert.ok(getDataSource('receiving.awaiting_tracking_pos'), 'receiving source registered');
  assert.ok(getDataSource('po_gmail.unmatched_emails'), 'gmail source registered');
  assert.ok(getDataSource('sourcing.open_demand'), 'sourcing source registered');
  assert.ok(getAction('incoming.attach_tracking'), 'attach-tracking action registered');
  assert.equal(getDataSource('does.not.exist'), undefined);
  assert.equal(getAction('does.not.exist'), undefined);
});

test('actionsForSource: attach_tracking matches a po_ref source by field kind', () => {
  const src = getDataSource('receiving.awaiting_tracking_pos')!;
  const ids = actionsForSource(src).map((a) => a.id);
  assert.ok(ids.includes('incoming.attach_tracking'), 'po_ref source offers attach-tracking');
  // A sourcing action (different integration, no matching kind) is NOT offered.
  assert.ok(!ids.includes('sourcing.start_sourcing'), 'incompatible action is excluded');
  assert.ok(listDataSources().length >= 3);
});

// ─── validateStationConfig ───────────────────────────────────────────────────

/** The composition the Phase-D seed binds to refurb-v1-receive — must validate clean. */
const VALID: StationConfig = {
  slots: {
    queue: [
      {
        id: 'blk_seedrx',
        block: 'checklist',
        source: {
          id: 'receiving.awaiting_tracking_pos',
          fields: { title: 'po_number', ref: 'vendor_name', meta: 'po_date' },
        },
        display: { variant: 'check_act' },
        actions: ['incoming.attach_tracking'],
        done_when: 'incoming.attach_tracking',
      },
    ],
  },
};

test('valid: the seed composition produces zero issues', () => {
  assert.deepEqual(validateStationConfig(VALID), []);
});

test("legacy: 'legacy' slots are an explicit escape hatch — always valid", () => {
  assert.deepEqual(validateStationConfig({ slots: 'legacy' }), []);
});

test('invalid: unknown block type is flagged', () => {
  const issues = validateStationConfig({ slots: { queue: [{ id: 'b1', block: 'ghost' }] } });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Unknown block type "ghost"/);
});

test('invalid: a block in a slot it did not declare is flagged', () => {
  // checklist only declares the `queue` slot.
  const issues = validateStationConfig({
    slots: { trigger: [{ id: 'b1', block: 'checklist', source: { id: 'receiving.awaiting_tracking_pos' } }] },
  });
  assert.ok(issues.some((i) => /cannot occupy the "trigger" slot/.test(i.message)));
});

test('invalid: a rows-block with no data source is flagged', () => {
  const issues = validateStationConfig({ slots: { queue: [{ id: 'b1', block: 'checklist' }] } });
  assert.ok(issues.some((i) => /needs a data source/.test(i.message)));
});

test('invalid: a role mapped to a field the source does not declare is flagged', () => {
  const issues = validateStationConfig({
    slots: {
      queue: [
        {
          id: 'b1',
          block: 'checklist',
          source: { id: 'receiving.awaiting_tracking_pos', fields: { title: 'nonsense_field' } },
        },
      ],
    },
  });
  assert.ok(issues.some((i) => /"nonsense_field", which/.test(i.message)));
});

test('invalid: an action incompatible with the bound source is flagged', () => {
  const issues = validateStationConfig({
    slots: {
      queue: [
        {
          id: 'b1',
          block: 'checklist',
          source: { id: 'receiving.awaiting_tracking_pos' },
          actions: ['sourcing.start_sourcing'],
        },
      ],
    },
  });
  assert.ok(issues.some((i) => /not compatible with source/.test(i.message)));
});

test('invalid: done_when must be one of the bound actions', () => {
  const issues = validateStationConfig({
    slots: {
      queue: [
        {
          id: 'b1',
          block: 'checklist',
          source: { id: 'receiving.awaiting_tracking_pos' },
          actions: ['incoming.attach_tracking'],
          done_when: 'incoming.mark_email_done',
        },
      ],
    },
  });
  assert.ok(issues.some((i) => /done_when .* must be one of the instance's bound actions/.test(i.message)));
});
