import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canShowTechSubstitution,
  type SubstitutionPolicy,
  type TechSubstitutionEligibilityInput,
} from './substitution-eligibility';

const POLICY_OK: SubstitutionPolicy = {
  enabled: true,
  enforcement: 'advisory',
  allowedNodes: ['pick', 'test'],
  canSubstitute: true,
};

function input(over: Partial<TechSubstitutionEligibilityInput> = {}): TechSubstitutionEligibilityInput {
  return {
    policy: POLICY_OK,
    activeOrder: {
      id: 42,
      orderId: '#A-1047',
      tracking: '1Z999AA10123456784',
      fnsku: null,
      sourceType: 'order',
      orderFound: true,
    },
    mode: 'active',
    previewOrderId: null,
    ...over,
  };
}

test('eligible order session shows with the order id + label', () => {
  const r = canShowTechSubstitution(input());
  assert.equal(r.show, true);
  assert.equal(r.orderId, 42);
  assert.equal(r.orderLabel, '#A-1047');
});

test('hidden when policy is undefined (query still loading / errored)', () => {
  const r = canShowTechSubstitution(input({ policy: undefined }));
  assert.deepEqual(r, { show: false, orderId: null, orderLabel: '' });
});

test('hidden when policy.canSubstitute is false', () => {
  const r = canShowTechSubstitution(input({ policy: { ...POLICY_OK, canSubstitute: false } }));
  assert.equal(r.show, false);
});

test('hidden on an exception source session', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, sourceType: 'exception' },
  });
  assert.equal(r.show, false);
});

test('hidden on an FBA session (sourceType fba)', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, sourceType: 'fba' },
  });
  assert.equal(r.show, false);
});

test('hidden on an FNSKU session even when sourceType is order-ish', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, fnsku: 'X001ABC123' },
  });
  assert.equal(r.show, false);
});

test('hidden on a repair session (sourceType repair)', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, sourceType: 'repair' },
  });
  assert.equal(r.show, false);
});

test('hidden on an RS-# repair tracking even without sourceType', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, sourceType: undefined, tracking: 'rs-1043' },
  });
  assert.equal(r.show, false);
});

test('hidden when the active order id is null / zero / negative', () => {
  for (const id of [null, 0, -3, Number.NaN]) {
    const base = input();
    const r = canShowTechSubstitution({
      ...base,
      activeOrder: { ...base.activeOrder, id: id as number | null },
    });
    assert.equal(r.show, false, `id=${String(id)} should hide`);
  }
});

test('hidden when the order lookup came back not-found', () => {
  const base = input();
  const r = canShowTechSubstitution({
    ...base,
    activeOrder: { ...base.activeOrder, orderFound: false },
  });
  assert.equal(r.show, false);
});

test('preview mode uses previewOrderId when valid (§8: preview substitution allowed)', () => {
  const base = input({ mode: 'preview', previewOrderId: 77 });
  base.activeOrder.id = null; // preview sessions do not carry the numeric row id
  const r = canShowTechSubstitution(base);
  assert.equal(r.show, true);
  assert.equal(r.orderId, 77);
});

test('preview mode hides without a valid previewOrderId even when activeOrder.id is set', () => {
  const r = canShowTechSubstitution(input({ mode: 'preview', previewOrderId: null }));
  assert.equal(r.show, false);
});

test('orderLabel falls back tracking → #id when orderId is blank', () => {
  const base = input();
  base.activeOrder.orderId = '  ';
  let r = canShowTechSubstitution(base);
  assert.equal(r.orderLabel, '1Z999AA10123456784');

  base.activeOrder.tracking = '';
  r = canShowTechSubstitution(base);
  assert.equal(r.orderLabel, '#42');
});

test('orderFound undefined (legacy sessions) does not hide', () => {
  const base = input();
  base.activeOrder.orderFound = undefined;
  assert.equal(canShowTechSubstitution(base).show, true);
});
