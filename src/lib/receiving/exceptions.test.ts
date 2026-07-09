import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordReceivingException,
  listReceivingLineExceptions,
  resolveReceivingExceptions,
  type ReceivingExceptionsDeps,
} from './exceptions';
import type { OrgId } from '@/lib/tenancy/constants';

const ORG = 'org-1' as unknown as OrgId;

function fakes(updateRows: Array<{ id: number }> = []) {
  const calls: Array<{ orgId: unknown; sql: string; params: unknown[] }> = [];
  const deps: ReceivingExceptionsDeps = {
    query: (async (orgId: unknown, sql: string, params: unknown[]) => {
      calls.push({ orgId, sql, params });
      if (/INSERT INTO receiving_exceptions/.test(sql)) return { rows: [{ id: 555 }] };
      if (/UPDATE receiving_exceptions/.test(sql)) return { rows: updateRows };
      return { rows: [{ id: 1 }] };
    }) as unknown as ReceivingExceptionsDeps['query'],
  };
  return { deps, calls };
}

test('recordReceivingException inserts an org-scoped row with all fields', async () => {
  const { deps, calls } = fakes();
  const r = await recordReceivingException(
    ORG,
    { receivingLineId: 7, receivingId: 42, exceptionCode: 'DAMAGED', reason: 'dent', createdBy: 9 },
    deps,
  );
  assert.equal(r.id, 555);
  assert.match(calls[0].sql, /INSERT INTO receiving_exceptions/);
  assert.equal(calls[0].orgId, ORG);
  assert.deepEqual(calls[0].params, [ORG, 7, 42, 'DAMAGED', 'dent', null, null, 9]);
});

test('recordReceivingException defaults optional fields to null', async () => {
  const { deps, calls } = fakes();
  await recordReceivingException(ORG, { receivingLineId: 5, exceptionCode: 'PROBLEM' }, deps);
  assert.deepEqual(calls[0].params, [ORG, 5, null, 'PROBLEM', null, null, null, null]);
});

test('listReceivingLineExceptions queries newest-first scoped to org+line', async () => {
  const { deps, calls } = fakes();
  await listReceivingLineExceptions(ORG, 7, deps);
  assert.match(calls[0].sql, /ORDER BY created_at DESC/);
  assert.deepEqual(calls[0].params, [ORG, 7]);
});

test('resolveReceivingExceptions returns the resolved count + threads the code filter', async () => {
  const { deps, calls } = fakes([{ id: 1 }, { id: 2 }]);
  const n = await resolveReceivingExceptions(ORG, 7, { exceptionCode: 'DAMAGED', resolvedBy: 3 }, deps);
  assert.equal(n, 2);
  assert.deepEqual(calls[0].params, [ORG, 7, 3, 'DAMAGED']);
});
