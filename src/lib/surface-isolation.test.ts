import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTestingApiView,
  isTestingSurfacePath,
  resolveLiveReceivingMode,
  stripCrossSurfaceParams,
} from '@/lib/surface-isolation';

test('resolveLiveReceivingMode is path-first for graduated routes', () => {
  const sp = new URLSearchParams('');
  assert.equal(resolveLiveReceivingMode('/receiving/history', sp), 'history');
  assert.equal(resolveLiveReceivingMode('/unbox', sp), 'receive');
  assert.equal(resolveLiveReceivingMode('/triage', sp), 'triage');
});

test('resolveLiveReceivingMode falls back to ?mode= on legacy /receiving', () => {
  assert.equal(
    resolveLiveReceivingMode('/receiving', new URLSearchParams('mode=history')),
    'history',
  );
});

test('isTestingApiView recognises testing feeds only', () => {
  assert.equal(isTestingApiView('testing'), true);
  assert.equal(isTestingApiView('needs-test'), true);
  assert.equal(isTestingApiView('recent'), false);
});

test('stripCrossSurfaceParams removes testing view on receiving paths', () => {
  const params = new URLSearchParams('view=testing&mode=receive&recvId=1');
  const next = stripCrossSurfaceParams('/unbox', params);
  assert.equal(next.get('view'), null);
  assert.equal(next.get('recvId'), '1');
});

test('stripCrossSurfaceParams removes receiving mode on testing paths', () => {
  const params = new URLSearchParams('view=testing&mode=triage&unboxview=queue');
  const next = stripCrossSurfaceParams('/test', params);
  assert.equal(next.get('view'), 'testing');
  assert.equal(next.get('mode'), null);
  assert.equal(next.get('unboxview'), null);
});

test('isTestingSurfacePath matches /test and legacy /tech', () => {
  assert.equal(isTestingSurfacePath('/test'), true);
  assert.equal(isTestingSurfacePath('/tech'), true);
  assert.equal(isTestingSurfacePath('/unbox'), false);
});
