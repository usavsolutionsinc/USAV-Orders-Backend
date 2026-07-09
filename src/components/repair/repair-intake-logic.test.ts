import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPAIR_STEP_COPY,
  buildInitialFormData,
  formatPhone,
  isContactFieldValid,
  canSubmitRepairIntake,
  getRepairSubmitBlockReason,
  hasRepairIssue,
  isContactComplete,
  isProductSelected,
} from './repair-intake-logic';

// ─── buildInitialFormData ─────────────────────────────────────────────────────

test('buildInitialFormData: empty defaults, price 130', () => {
  const data = buildInitialFormData();
  assert.equal(data.price, '130');
  assert.deepEqual(data.repairReasons, []);
  assert.equal(data.assignedTechId, null);
  assert.equal(data.signatureDataUrl, null);
});

test('buildInitialFormData: merges provided fields, keeps overridden price', () => {
  const data = buildInitialFormData({
    product: { type: 'Bose Repair Service', model: 'QC45' },
    price: '250',
    customer: { name: 'Jo', phone: '5551234567', email: '' },
  });
  assert.equal(data.product.model, 'QC45');
  assert.equal(data.price, '250');
  assert.equal(data.customer.name, 'Jo');
});

// ─── isContactFieldValid ──────────────────────────────────────────────────────

const baseForm = buildInitialFormData();

test('isContactFieldValid: required fields gate on non-empty trimmed value', () => {
  assert.equal(isContactFieldValid('name', baseForm), false);
  assert.equal(isContactFieldValid('name', { ...baseForm, customer: { ...baseForm.customer, name: '  ' } }), false);
  assert.equal(isContactFieldValid('name', { ...baseForm, customer: { ...baseForm.customer, name: 'Jo' } }), true);
});

test('isContactFieldValid: extras require a serial (price defaults to 130)', () => {
  // price defaults to '130', so extras gate only on the serial number
  assert.equal(isContactFieldValid('extras', baseForm), false);
  assert.equal(isContactFieldValid('extras', { ...baseForm, serialNumber: 'SN1' }), true);
  assert.equal(isContactFieldValid('extras', { ...baseForm, serialNumber: 'SN1', price: '' }), false);
});

test('isContactFieldValid: email is always optional', () => {
  assert.equal(isContactFieldValid('email', baseForm), true);
});

test('canSubmitRepairIntake: requires product, issue, contact, and signature', () => {
  const complete = {
    ...baseForm,
    product: { type: 'Bose Repair Service', model: 'QC45', sourceSku: 'SKU-RS' },
    repairNotes: 'No power',
    customer: { name: 'Jo', phone: '555-123-4567', email: '' },
    serialNumber: 'SN1',
    price: '130',
  };
  assert.equal(canSubmitRepairIntake(complete, true), true);
  assert.equal(canSubmitRepairIntake(complete, false), false);
  assert.equal(canSubmitRepairIntake({ ...complete, repairNotes: '', repairReasons: [] }, true), false);
  assert.equal(canSubmitRepairIntake({ ...complete, product: { type: '', model: '', sourceSku: null } }, true), false);
  assert.equal(canSubmitRepairIntake({ ...complete, serialNumber: '' }, true), false);
});

test('getRepairSubmitBlockReason: names the first missing requirement', () => {
  assert.equal(getRepairSubmitBlockReason(baseForm, false), 'Select a repair product to submit');
  const withProduct = {
    ...baseForm,
    product: { type: 'Bose Repair Service', model: 'QC45', sourceSku: null },
  };
  assert.equal(getRepairSubmitBlockReason(withProduct, false), 'Issue or repair notes required to submit');
});

// ─── formatPhone ──────────────────────────────────────────────────────────────

test('formatPhone: formats a clean 10-digit number', () => {
  assert.equal(formatPhone('5551234567'), '555-123-4567');
});

test('formatPhone: strips non-digits before formatting', () => {
  assert.equal(formatPhone('(555) 123-4567'), '555-123-4567');
});

test('formatPhone: passes through non-10-digit input unchanged', () => {
  assert.equal(formatPhone('12345'), '12345');
  assert.equal(formatPhone('+1 555 123 4567'), '+1 555 123 4567');
});

// ─── REPAIR_STEP_COPY ─────────────────────────────────────────────────────────

test('REPAIR_STEP_COPY: every step has title + subtitle', () => {
  for (const step of ['product', 'issue', 'contact', 'review'] as const) {
    assert.ok(REPAIR_STEP_COPY[step].title.length > 0);
    assert.ok(REPAIR_STEP_COPY[step].subtitle.length > 0);
  }
});
