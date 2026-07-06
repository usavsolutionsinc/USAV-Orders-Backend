import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_SAVED_VIEWS,
  systemViewParam,
  isSystemViewParam,
  resolveSystemSavedView,
} from './saved-view-presets';

test('systemViewParam / isSystemViewParam round-trip', () => {
  assert.equal(systemViewParam('pack-audit'), 'sys:pack-audit');
  assert.equal(isSystemViewParam('sys:pack-audit'), true);
  assert.equal(isSystemViewParam('42'), false); // a user view's numeric id
  assert.equal(isSystemViewParam(null), false);
  assert.equal(isSystemViewParam(undefined), false);
});

test('resolveSystemSavedView: resolves known ids, rejects everything else', () => {
  const pack = resolveSystemSavedView('sys:pack-audit');
  assert.equal(pack?.name, 'Pack');
  assert.deepEqual(pack?.filters, { stations: ['PACK'] });

  assert.equal(resolveSystemSavedView('sys:does-not-exist'), null);
  assert.equal(resolveSystemSavedView('pack-audit'), null); // missing prefix
  assert.equal(resolveSystemSavedView('42'), null);
  assert.equal(resolveSystemSavedView(null), null);
});

test('no system preset carries the admin-only audit spine', () => {
  for (const v of SYSTEM_SAVED_VIEWS) {
    assert.ok(
      !(v.filters.sources ?? []).includes('audit'),
      `preset ${v.id} must not include the audit source`,
    );
  }
});
