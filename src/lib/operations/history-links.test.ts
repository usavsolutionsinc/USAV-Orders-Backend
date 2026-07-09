import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsHistoryTraceHref, operationsSignalsBrowseHref } from './history-links';

test('operationsHistoryTraceHref: dim doubles as the record param name', () => {
  assert.equal(
    operationsHistoryTraceHref({ dim: 'serial', value: 'ABC123' }),
    '/operations?mode=history&dim=serial&serial=ABC123',
  );
  assert.equal(
    operationsHistoryTraceHref({ dim: 'order', value: '  1042  ' }), // trimmed
    '/operations?mode=history&dim=order&order=1042',
  );
});

test('operationsHistoryTraceHref: threads optional filters', () => {
  const href = operationsHistoryTraceHref({
    dim: 'tracking',
    value: '1Z999',
    filters: { stations: ['TECH', 'PACK'], sources: ['sal'], from: '2026-07-01', staffId: '7' },
  });
  const sp = new URL(`https://x${href}`).searchParams;
  assert.equal(sp.get('mode'), 'history');
  assert.equal(sp.get('dim'), 'tracking');
  assert.equal(sp.get('tracking'), '1Z999');
  assert.equal(sp.get('stations'), 'TECH,PACK');
  assert.equal(sp.get('sources'), 'sal');
  assert.equal(sp.get('from'), '2026-07-01');
  assert.equal(sp.get('staffId'), '7');
});

test('operationsSignalsBrowseHref: entity-scoped and bare', () => {
  assert.equal(
    operationsSignalsBrowseHref({ entityType: 'SERIAL_UNIT', entityId: 123 }),
    '/operations?mode=signals&signalsView=browse&entityType=SERIAL_UNIT&entityId=123',
  );
  assert.equal(
    operationsSignalsBrowseHref({}),
    '/operations?mode=signals&signalsView=browse',
  );
  // signalKind + nodeId ride along.
  const href = operationsSignalsBrowseHref({ signalKind: 'exception', nodeId: 'n1' });
  const sp = new URL(`https://x${href}`).searchParams;
  assert.equal(sp.get('signalKind'), 'exception');
  assert.equal(sp.get('nodeId'), 'n1');
});
