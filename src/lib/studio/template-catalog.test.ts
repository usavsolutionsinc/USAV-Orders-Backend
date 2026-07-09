/**
 * DB-free tests for template-first onboarding apply (Phase 5).
 * Run: npx tsx --test src/lib/studio/template-catalog.test.ts
 */

import '@/lib/assistant/test-db-url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplateToOrg, type ApplyTemplateDeps } from './template-catalog';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = '11111111-2222-3333-4444-555555555555' as OrgId;

function fakes(opts: { existing?: boolean; defaultTemplateId?: number | null; cloneStatus?: 200 | 404 } = {}) {
  const cap = {
    createDraftArgs: [] as Array<{ templateId: number; staffId: number | null }>,
    activateCalls: 0,
    queries: [] as string[],
  };
  const client = {
    async query(text: string, _params?: ReadonlyArray<unknown>) {
      cap.queries.push(text);
      if (text.includes('SELECT 1 FROM workflow_definitions')) {
        return { rows: opts.existing ? [{ '?column?': 1 }] : [] };
      }
      if (text.includes('FROM workflow_templates')) {
        return { rows: opts.defaultTemplateId == null ? [] : [{ id: opts.defaultTemplateId }] };
      }
      if (text.includes('UPDATE workflow_definitions SET is_active = TRUE')) {
        cap.activateCalls += 1;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const deps: ApplyTemplateDeps = {
    runTransaction: (_orgId, fn) => fn(client),
    createDraft: (async (a: { templateId: number; staffId: number | null }) => {
      cap.createDraftArgs.push({ templateId: a.templateId, staffId: a.staffId });
      return opts.cloneStatus === 404
        ? { status: 404 as const, body: { ok: false as const, error: 'template not found' } }
        : { status: 200 as const, body: { ok: true as const, id: 99, version: 1 } };
    }) as ApplyTemplateDeps['createDraft'],
  };
  return { deps, cap };
}

test('applyTemplateToOrg: skipIfExists no-ops when the org already has a definition', async () => {
  const { deps, cap } = fakes({ existing: true });
  const out = await applyTemplateToOrg({ orgId: ORG, staffId: 3, activate: true, skipIfExists: true }, deps);
  assert.deepEqual(out, { status: 200, seeded: false, definitionId: null, activated: false, reason: 'org already has a definition' });
  assert.equal(cap.createDraftArgs.length, 0);
  assert.equal(cap.activateCalls, 0);
});

test('applyTemplateToOrg: onboarding first-seed resolves the default template, clones + activates', async () => {
  const { deps, cap } = fakes({ existing: false, defaultTemplateId: 7 });
  const out = await applyTemplateToOrg({ orgId: ORG, staffId: 3, activate: true, skipIfExists: true }, deps);
  assert.equal(out.status, 200);
  assert.equal(out.seeded, true);
  assert.equal(out.definitionId, 99);
  assert.equal(out.activated, true);
  assert.deepEqual(cap.createDraftArgs, [{ templateId: 7, staffId: 3 }]); // default template picked
  assert.equal(cap.activateCalls, 1);
});

test('applyTemplateToOrg: explicit template, no activate → draft only', async () => {
  const { deps, cap } = fakes({ existing: false });
  const out = await applyTemplateToOrg({ orgId: ORG, staffId: 3, templateId: 42 }, deps);
  assert.equal(out.seeded, true);
  assert.equal(out.activated, false);
  assert.equal(cap.activateCalls, 0);
  assert.equal(cap.createDraftArgs[0].templateId, 42);
  // Did NOT look up the default template (explicit id given).
  assert.ok(!cap.queries.some((q) => q.includes('FROM workflow_templates')));
});

test('applyTemplateToOrg: no system template → 404', async () => {
  const { deps, cap } = fakes({ existing: false, defaultTemplateId: null });
  const out = await applyTemplateToOrg({ orgId: ORG, staffId: null, activate: true }, deps);
  assert.equal(out.status, 404);
  assert.equal(out.seeded, false);
  assert.equal(cap.createDraftArgs.length, 0);
});

test('applyTemplateToOrg: clone failure surfaces, nothing activated', async () => {
  const { deps, cap } = fakes({ existing: false, defaultTemplateId: 7, cloneStatus: 404 });
  const out = await applyTemplateToOrg({ orgId: ORG, staffId: 3, activate: true }, deps);
  assert.equal(out.status, 404);
  assert.equal(out.seeded, false);
  assert.equal(cap.activateCalls, 0);
});
