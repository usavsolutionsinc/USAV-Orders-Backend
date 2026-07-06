/**
 * ops_events CHECK ⇄ code drift-guard (DB-free).
 *
 * The `ops_events.entity_type` CHECK (migration 2026-07-06) is a deploy-time
 * vocabulary that MUST stay byte-identical with the code source of truth
 * `OPS_EVENT_ENTITY_TYPES`, and must cover every value the two live writers can
 * emit — otherwise a CHECK could reject a live write (the worst kind of
 * regression, per the plan's Phase 0 gate). This pins all three together so
 * they can never drift silently (same idea as surfaces/registry.test.ts).
 *
 * Run: npm run test:ops-events
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPS_EVENT_ENTITY_TYPES } from './ops-events';
import { SURFACE_ENTITY_TYPES } from './surfaces/registry';

const MIGRATION = join(
  process.cwd(),
  'src',
  'lib',
  'migrations',
  '2026-07-06_ops_events_entity_type_chk_and_workflow_node.sql',
);

function migrationSql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

// DDL only — strips line comments and block comments so FK/DDL assertions never
// match explanatory prose (the header quotes the rejected
// "REFERENCES workflow_nodes(id)" sketch on purpose).
function migrationDdl(): string {
  return migrationSql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function extractCheckValues(sql: string, constraintName: string): string[] {
  const re = new RegExp(`${constraintName}\\s+CHECK \\(\\w+ IN \\(([^)]+)\\)\\)`, 'm');
  const m = sql.match(re);
  assert.ok(m, `CHECK constraint ${constraintName} not found`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

test('entity_type CHECK in the migration mirrors OPS_EVENT_ENTITY_TYPES exactly', () => {
  const values = extractCheckValues(migrationSql(), 'ops_events_entity_type_chk');
  assert.deepEqual(values, [...OPS_EVENT_ENTITY_TYPES]);
});

test('every registry opsEventEntityType is covered by the CHECK (no writer can be rejected)', () => {
  const allowed = new Set<string>(OPS_EVENT_ENTITY_TYPES);
  for (const [key, def] of Object.entries(SURFACE_ENTITY_TYPES)) {
    assert.ok(
      allowed.has(def.opsEventEntityType),
      `${key}.opsEventEntityType="${def.opsEventEntityType}" is not in OPS_EVENT_ENTITY_TYPES / the CHECK`,
    );
  }
});

test('OPS_EVENT_ENTITY_TYPES values are lower_snake and unique', () => {
  const seen = new Set<string>();
  for (const v of OPS_EVENT_ENTITY_TYPES) {
    assert.match(v, /^[a-z][a-z_]*$/, `${v} must be lower_snake`);
    assert.ok(!seen.has(v), `duplicate entity_type ${v}`);
    seen.add(v);
  }
});

test('workflow_node_id is added FK-FREE (a real FK would break on wholesale node replace)', () => {
  const ddl = migrationDdl();
  assert.match(ddl, /ADD COLUMN IF NOT EXISTS workflow_node_id TEXT/);
  // The whole point of the deviation from the plan's §3.3 sketch: NO FK to
  // workflow_nodes (rows are replaced wholesale on every Studio graph save).
  // Checked against comment-stripped DDL so header prose can't false-positive.
  assert.ok(
    !/REFERENCES\s+workflow_nodes/i.test(ddl),
    'ops_events must NOT declare a real FK to workflow_nodes(id)',
  );
});

test('partial node index is present and scoped to non-null node ids', () => {
  const ddl = migrationDdl();
  assert.match(ddl, /idx_ops_events_org_node_time/);
  assert.match(ddl, /WHERE workflow_node_id IS NOT NULL/);
});
