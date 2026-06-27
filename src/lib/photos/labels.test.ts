import assert from 'node:assert/strict';
import test from 'node:test';
import {
  slugifyLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  setPhotoLabels,
  bulkApplyLabels,
  LabelValidationError,
  LabelConflictError,
  LabelSystemGuardError,
  type LabelDeps,
} from '@/lib/photos/labels';

const ORG = '00000000-0000-0000-0000-000000000001';

interface Call {
  sql: string;
  params: unknown[];
}

/**
 * Build a fake LabelDeps. `respond(sql, params)` returns the rows for each
 * client.query call; every call is captured in `calls` for assertions. Both
 * tenantQuery and withTenantTransaction route through the same responder.
 */
function fakes(respond: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number }) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const r = respond(sql, params);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) };
    },
  };
  const deps = {
    tenantQuery: async (_org: string, sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const r = respond(sql, params);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) };
    },
    withTenantTransaction: async (_org: string, cb: (c: typeof client) => Promise<unknown>) => cb(client),
  } as unknown as LabelDeps;
  return { deps, calls };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  key: 'front',
  label: 'Front',
  color: 'blue',
  icon: null,
  scope_image_type: null,
  is_system: false,
  sort_index: 0,
  ...over,
});

test('slugifyLabel lowercases, dashes, and trims to a safe token', () => {
  assert.equal(slugifyLabel('  Serial / Label!! '), 'serial-label');
  assert.equal(slugifyLabel(''), 'label');
  assert.equal(slugifyLabel('Front'), 'front');
});

test('createLabel rejects an empty name before touching the DB', async () => {
  const { deps, calls } = fakes(() => ({ rows: [] }));
  await assert.rejects(() => createLabel(ORG, { label: '   ' }, deps), LabelValidationError);
  assert.equal(calls.length, 0, 'no DB calls on validation failure');
});

test('createLabel inserts a slugged label and maps the row', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('SELECT 1 FROM photo_labels')) return { rows: [] }; // no dup
    if (sql.includes('INSERT INTO photo_labels')) return { rows: [row({ key: 'back', label: 'Back' })] };
    return { rows: [] };
  });
  const created = await createLabel(ORG, { label: 'Back', color: 'blue' }, deps);
  assert.equal(created.key, 'back');
  assert.equal(created.color, 'blue');
  const insert = calls.find((c) => c.sql.includes('INSERT INTO photo_labels'));
  assert.ok(insert, 'an INSERT ran');
  // params: [orgId, key, label, color, icon, scopeImageType]
  assert.equal(insert!.params[1], 'back', 'key is the slug');
});

test('createLabel surfaces a duplicate key as a conflict', async () => {
  const { deps } = fakes((sql) => {
    if (sql.includes('SELECT 1 FROM photo_labels')) return { rows: [{ '?column?': 1 }] }; // dup exists
    return { rows: [] };
  });
  await assert.rejects(() => createLabel(ORG, { label: 'Front' }, deps), LabelConflictError);
});

test('createLabel coerces an unknown color to the default token', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('SELECT 1 FROM photo_labels')) return { rows: [] };
    if (sql.includes('INSERT INTO photo_labels')) return { rows: [row()] };
    return { rows: [] };
  });
  await createLabel(ORG, { label: 'X', color: '#ff0000' as unknown as string }, deps);
  const insert = calls.find((c) => c.sql.includes('INSERT INTO photo_labels'))!;
  assert.equal(insert.params[3], 'slate', 'invalid hex color falls back to the default token');
});

test('updateLabel refuses to edit a system label', async () => {
  const { deps } = fakes((sql) => {
    if (sql.includes('FOR UPDATE')) return { rows: [row({ is_system: true })], rowCount: 1 };
    return { rows: [] };
  });
  await assert.rejects(() => updateLabel(ORG, 1, { label: 'Nope' }, deps), LabelSystemGuardError);
});

test('deleteLabel refuses to delete a system label', async () => {
  const { deps } = fakes((sql) => {
    if (sql.includes('FOR UPDATE')) return { rows: [{ is_system: true }], rowCount: 1 };
    return { rows: [] };
  });
  await assert.rejects(() => deleteLabel(ORG, 1, deps), LabelSystemGuardError);
});

test('setPhotoLabels threads only org-owned label ids into the assignment insert', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('FROM photos WHERE')) return { rows: [{ ok: 1 }], rowCount: 1 };
    if (sql.includes('SELECT id FROM photo_labels')) return { rows: [{ id: 1 }, { id: 2 }] }; // 3 is foreign
    if (sql.includes('DELETE FROM photo_label_assignments')) return { rows: [] };
    if (sql.includes('INSERT INTO photo_label_assignments')) return { rows: [] };
    if (sql.includes('IN (SELECT label_id')) return { rows: [row({ id: 1 }), row({ id: 2, key: 'back', label: 'Back' })] };
    return { rows: [] };
  });
  const result = await setPhotoLabels(ORG, 99, [1, 2, 3], 7, deps);
  assert.deepEqual(result.map((l) => l.id), [1, 2]);
  const insert = calls.find((c) => c.sql.includes('INSERT INTO photo_label_assignments'))!;
  assert.deepEqual(insert.params[2], [1, 2], 'foreign label id 3 is dropped');
  assert.equal(insert.params[3], 7, 'assigned_by_staff_id is threaded');
});

test('setPhotoLabels with an empty set deletes all and skips the insert', async () => {
  const { deps, calls } = fakes((sql) => {
    if (sql.includes('FROM photos WHERE')) return { rows: [{ ok: 1 }], rowCount: 1 };
    return { rows: [] };
  });
  await setPhotoLabels(ORG, 99, [], null, deps);
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM photo_label_assignments')), 'a DELETE ran');
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO photo_label_assignments')), 'no INSERT for empty set');
});

test('bulkApplyLabels short-circuits when no photos are supplied', async () => {
  const { deps, calls } = fakes(() => ({ rows: [] }));
  const res = await bulkApplyLabels(ORG, [], [1], [], null, deps);
  assert.equal(res.photos, 0);
  assert.equal(calls.length, 0, 'no DB work without photos');
});

test('bulkApplyLabels issues both a remove and an add when given each', async () => {
  const { deps, calls } = fakes(() => ({ rows: [] }));
  const res = await bulkApplyLabels(ORG, [10, 11], [1], [2], 5, deps);
  assert.equal(res.photos, 2);
  assert.ok(calls.some((c) => c.sql.includes('DELETE FROM photo_label_assignments')), 'remove ran');
  assert.ok(calls.some((c) => c.sql.includes('INSERT INTO photo_label_assignments')), 'add ran');
});
