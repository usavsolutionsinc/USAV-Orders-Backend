/**
 * Universal-surfaces kind-catalog guard tests — DB-free.
 *
 * Two jobs:
 *  1. Internal integrity (every def well-formed, cross-references valid).
 *  2. DB-mirror pinning: the registry's entity_type list must stay
 *     byte-identical with the `*_entity_type_chk` CHECK lists and the
 *     delete-trigger coverage in migrations 2026-07-03j/k/l — the same
 *     drift-guard idea as reason-codes.guard.test.ts.
 *
 * Run: npm run test:surfaces
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_MUTATION_STATUSES,
  FEED_KEYS,
  FEED_MEMBERSHIP_STATES,
  FEED_MEMBERSHIP_TONES,
  INSIGHT_LINKAGE_TYPES,
  INSIGHT_SUBJECT_KINDS,
  MUTATION_KINDS,
  MUTATION_TARGET_KINDS,
  NODE_SURFACE_ROLES,
  SIGNAL_KINDS,
  SURFACE_ENTITY_TYPES,
  SURFACE_ENTITY_TYPE_LIST,
  isFeedKey,
  isMutationKind,
  isSignalKind,
  isSurfaceEntityType,
  mutationTrustClass,
} from './registry';

const MIGRATIONS_DIR = join(process.cwd(), 'src', 'lib', 'migrations');

function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

function extractCheckValues(sql: string, constraintName: string): string[] {
  const re = new RegExp(`${constraintName}\\s+CHECK \\(\\w+ IN \\(([^)]+)\\)\\)`, 'm');
  const m = sql.match(re);
  assert.ok(m, `CHECK constraint ${constraintName} not found`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

// ── 1. Internal integrity ────────────────────────────────────────────────────

test('entity types: every def names a parent table + ops_events mapping + description', () => {
  for (const [key, def] of Object.entries(SURFACE_ENTITY_TYPES)) {
    assert.match(key, /^[A-Z][A-Z_]*$/, `entity type ${key} must be UPPER_SNAKE`);
    assert.ok(def.parentTable.length > 0, `${key} missing parentTable`);
    assert.match(def.opsEventEntityType, /^[a-z][a-z_]*$/, `${key} opsEventEntityType must be lower_snake`);
    assert.ok(def.description.length > 20, `${key} needs a real description (AI reads it)`);
  }
});

test('feed keys: lower_snake, valid entityType, real descriptions', () => {
  for (const [key, def] of Object.entries(FEED_KEYS)) {
    assert.match(key, /^[a-z][a-z0-9_]*$/, `feed_key ${key} must be lower_snake`);
    assert.ok(isSurfaceEntityType(def.entityType), `feed_key ${key} anchors on unknown entity type ${def.entityType}`);
    assert.ok(def.description.length > 20, `feed_key ${key} needs a real description`);
  }
});

test('signal kinds: lower_snake, valid entityTypes, origin set, real descriptions', () => {
  for (const [key, def] of Object.entries(SIGNAL_KINDS)) {
    assert.match(key, /^[a-z][a-z0-9_]*$/, `signal_kind ${key} must be lower_snake`);
    assert.ok(def.entityTypes.length > 0, `signal_kind ${key} must anchor on at least one entity type`);
    for (const et of def.entityTypes) {
      assert.ok(isSurfaceEntityType(et), `signal_kind ${key} anchors on unknown entity type ${et}`);
    }
    assert.ok(def.origin === 'internal' || def.origin === 'external', `signal_kind ${key} origin invalid`);
    assert.ok(def.description.length > 20, `signal_kind ${key} needs a real description`);
  }
});

test('mutation kinds: dotted names, valid trust class, target kind derivable', () => {
  for (const [key, def] of Object.entries(MUTATION_KINDS)) {
    assert.match(key, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, `mutation_kind ${key} must be <domain>.<verb>`);
    assert.ok(['auto', 'draft_scoped', 'review'].includes(def.trust), `mutation_kind ${key} trust invalid`);
    assert.match(def.targetKind, /^[a-z][a-z0-9_]*$/, `mutation_kind ${key} targetKind must be lower_snake`);
    assert.ok(def.description.length > 20, `mutation_kind ${key} needs a real description`);
    assert.ok((MUTATION_TARGET_KINDS as readonly string[]).includes(def.targetKind));
  }
});

test('trust model (plan §-2, locked): auto = view-layer kinds ONLY; masters are review', () => {
  const autoKinds = Object.entries(MUTATION_KINDS)
    .filter(([, d]) => d.trust === 'auto')
    .map(([k]) => k)
    .sort();
  // The locked day-one auto-apply list. Widening it is a deliberate,
  // reviewed decision — update this assertion in the same PR as the registry.
  assert.deepEqual(autoKinds, [
    'entity_signal.insert',
    'feed_membership.set_state',
    'node_surface.set_config',
    'staff_rail_exclusion.delete',
    'staff_rail_exclusion.insert',
  ]);
  // Nothing touching identity/vocabulary/settings masters may ever be auto or draft-scoped.
  for (const kind of ['staff.create', 'staff.assign_station', 'reason_code.create', 'setting.update'] as const) {
    assert.equal(mutationTrustClass(kind), 'review', `${kind} must stay review-gated`);
  }
  // All workflow_draft.* kinds are draft-scoped (the draft is the safety layer).
  for (const [key, def] of Object.entries(MUTATION_KINDS)) {
    if (key.startsWith('workflow_draft.')) {
      assert.equal(def.trust, 'draft_scoped', `${key} must be draft_scoped`);
    }
  }
});

test('type guards accept members and reject strangers', () => {
  assert.ok(isSurfaceEntityType('SERIAL_UNIT'));
  assert.ok(!isSurfaceEntityType('serial_unit'));
  assert.ok(isFeedKey('receiving_triage'));
  assert.ok(!isFeedKey('nonexistent_feed'));
  assert.ok(isSignalKind('buyer_note'));
  assert.ok(!isSignalKind('BUYER_NOTE'));
  assert.ok(isMutationKind('staff.create'));
  assert.ok(!isMutationKind('staff.delete'));
});

test('small stable sets are what the code expects', () => {
  assert.deepEqual([...FEED_MEMBERSHIP_STATES], ['active', 'needs_match', 'done']);
  assert.deepEqual([...FEED_MEMBERSHIP_TONES], ['default', 'info', 'success', 'warning', 'danger', 'muted']);
  assert.deepEqual([...AGENT_MUTATION_STATUSES], ['proposed', 'under_review', 'approved', 'applied', 'rejected', 'reverted']);
  assert.deepEqual([...INSIGHT_SUBJECT_KINDS], ['node_type', 'feed_key', 'signal_kind']);
  assert.ok(Object.keys(INSIGHT_LINKAGE_TYPES).length >= 3);
  assert.ok(Object.keys(NODE_SURFACE_ROLES).length >= 2);
});

// ── 2. DB-mirror pinning against the Phase 0 migrations ─────────────────────

const ENTITY_CHECK_FILES: Array<[file: string, constraint: string]> = [
  ['2026-07-03j_feed_memberships.sql', 'feed_memberships_entity_type_chk'],
  ['2026-07-03k_staff_rail_exclusions.sql', 'staff_rail_exclusions_entity_type_chk'],
  ['2026-07-03l_entity_signals.sql', 'entity_signals_entity_type_chk'],
];

test('entity_type CHECK lists in migrations mirror the registry exactly', () => {
  for (const [file, constraint] of ENTITY_CHECK_FILES) {
    const values = extractCheckValues(migrationSql(file), constraint);
    assert.deepEqual(
      [...values].sort(),
      [...SURFACE_ENTITY_TYPE_LIST].sort(),
      `${file} ${constraint} drifted from SURFACE_ENTITY_TYPES`,
    );
  }
});

test('every entity type has a delete trigger on its parent in each polymorphic child migration', () => {
  for (const [file] of ENTITY_CHECK_FILES) {
    const sql = migrationSql(file);
    for (const [entityType, def] of Object.entries(SURFACE_ENTITY_TYPES)) {
      const dispatch = `('${entityType}')`;
      assert.ok(sql.includes(dispatch), `${file}: no delete trigger dispatching ${entityType}`);
      assert.ok(
        new RegExp(`AFTER DELETE ON ${def.parentTable}\\b`).test(sql),
        `${file}: no AFTER DELETE trigger on parent table ${def.parentTable}`,
      );
    }
  }
});

test('membership state/tone + mutation status CHECKs mirror the registry', () => {
  const feedSql = migrationSql('2026-07-03j_feed_memberships.sql');
  assert.deepEqual(extractCheckValues(feedSql, 'feed_memberships_state_chk'), [...FEED_MEMBERSHIP_STATES]);
  assert.deepEqual(extractCheckValues(feedSql, 'feed_memberships_tone_chk'), [...FEED_MEMBERSHIP_TONES]);
  const mutSql = migrationSql('2026-07-03o_agent_mutations.sql');
  assert.deepEqual(extractCheckValues(mutSql, 'agent_mutations_status_chk'), [...AGENT_MUTATION_STATUSES]);
});
