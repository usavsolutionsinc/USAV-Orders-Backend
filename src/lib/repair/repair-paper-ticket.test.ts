import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRepairPaperTicketNumber, formatRepairSubmittedChromeLabel, isRsDisplayCode } from './repair-paper-ticket';

test('isRsDisplayCode: matches internal RS codes', () => {
  assert.equal(isRsDisplayCode('RS-74'), true);
  assert.equal(isRsDisplayCode('RS-0074'), true);
  assert.equal(isRsDisplayCode('#9347'), false);
});

test('formatRepairPaperTicketNumber: hides RS codes and formats Zendesk ids', () => {
  assert.equal(formatRepairPaperTicketNumber('RS-74'), '');
  assert.equal(formatRepairPaperTicketNumber('9347'), '#9347');
  assert.equal(formatRepairPaperTicketNumber('#9347'), '#9347');
  assert.equal(formatRepairPaperTicketNumber(null), '');
});

test('formatRepairSubmittedChromeLabel: prefers Zendesk ticket over RS code', () => {
  assert.equal(formatRepairSubmittedChromeLabel('9347'), '#9347');
  assert.equal(formatRepairSubmittedChromeLabel('RS-74'), 'Repair submitted');
  assert.equal(formatRepairSubmittedChromeLabel(null), 'Repair submitted');
});
