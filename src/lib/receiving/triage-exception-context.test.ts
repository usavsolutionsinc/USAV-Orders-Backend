import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexReceivingExceptions,
  exceptionDotTone,
  exceptionDotClass,
  exceptionTooltipLabel,
  exceptionAgeLabel,
  type ReceivingExceptionRow,
} from './triage-exception-context';

const row = (over: Partial<ReceivingExceptionRow>): ReceivingExceptionRow => ({
  receiving_id: 101,
  status: 'open',
  exception_reason: 'not_found',
  zoho_check_count: 3,
  last_zoho_check_at: null,
  last_error: null,
  ...over,
});

test('indexReceivingExceptions keys open rows by receiving_id', () => {
  const map = indexReceivingExceptions([row({ receiving_id: 101 }), row({ receiving_id: 202 })]);
  assert.equal(map.size, 2);
  assert.equal(map.get(101)?.retryCount, 3);
  assert.equal(map.get(202)?.receivingId, 202);
});

test('indexReceivingExceptions skips non-open, unlinked, and invalid rows', () => {
  const map = indexReceivingExceptions([
    row({ receiving_id: 1, status: 'resolved' }),
    row({ receiving_id: 2, status: 'discarded' }),
    row({ receiving_id: null }),
    row({ receiving_id: 0 }),
    row({ receiving_id: -5 }),
    row({ receiving_id: 9, status: 'open' }),
  ]);
  assert.deepEqual([...map.keys()], [9]);
});

test('indexReceivingExceptions keeps the FIRST open row per carton (route orders open/newest first)', () => {
  const map = indexReceivingExceptions([
    row({ receiving_id: 7, zoho_check_count: 5 }),
    row({ receiving_id: 7, zoho_check_count: 1 }),
  ]);
  assert.equal(map.get(7)?.retryCount, 5);
});

test('indexReceivingExceptions defaults missing reason/count safely', () => {
  const map = indexReceivingExceptions([
    row({ receiving_id: 3, exception_reason: null, zoho_check_count: null }),
  ]);
  assert.equal(map.get(3)?.reason, 'not_found');
  assert.equal(map.get(3)?.retryCount, 0);
});

test('exceptionDotTone + class: error → danger (rose), else warning (amber)', () => {
  const waiting = indexReceivingExceptions([row({ receiving_id: 1 })]).get(1)!;
  const erroring = indexReceivingExceptions([row({ receiving_id: 2, last_error: 'boom' })]).get(2)!;
  assert.equal(exceptionDotTone(waiting), 'warning');
  assert.equal(exceptionDotClass(waiting), 'bg-amber-500');
  assert.equal(exceptionDotTone(erroring), 'danger');
  assert.equal(exceptionDotClass(erroring), 'bg-rose-500');
});

test('exceptionAgeLabel: null → dash, future → now, scales units', () => {
  assert.equal(exceptionAgeLabel(null), '—');
  assert.equal(exceptionAgeLabel(new Date(Date.now() + 10_000).toISOString()), 'now');
  assert.equal(exceptionAgeLabel(new Date(Date.now() - 5_000).toISOString()), '5s');
  assert.equal(exceptionAgeLabel(new Date(Date.now() - 3 * 3600_000).toISOString()), '3h');
});

test('exceptionTooltipLabel: waiting vs erroring copy, singular check', () => {
  const single = indexReceivingExceptions([row({ receiving_id: 1, zoho_check_count: 1 })]).get(1)!;
  assert.match(exceptionTooltipLabel(single), /still hasn't synced/);
  assert.match(exceptionTooltipLabel(single), /1 check\b/);
  assert.match(exceptionTooltipLabel(single), /not checked yet/);

  const erroring = indexReceivingExceptions([
    row({ receiving_id: 2, zoho_check_count: 4, last_error: 'timeout' }),
  ]).get(2)!;
  const label = exceptionTooltipLabel(erroring);
  assert.match(label, /Zoho sync error/);
  assert.match(label, /4 checks/);
  assert.match(label, /timeout/);
});
