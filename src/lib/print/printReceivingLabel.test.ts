import test from 'node:test';
import assert from 'node:assert/strict';
import {
  labelCornerTicketDigits,
  receivingLabelPoCornerDisplay,
} from './printReceivingLabel';

test('labelCornerTicketDigits prefers Zendesk provider id over registry id', () => {
  assert.equal(
    labelCornerTicketDigits({
      providerTicketId: 9395,
      externalTicketId: '9395',
    }),
    '9395',
  );
});

test('receivingLabelPoCornerDisplay shows provider ticket on label face', () => {
  assert.equal(
    receivingLabelPoCornerDisplay({
      scanValue: 'RCV-6936',
      platform: 'Unfound',
      notes: '',
      conditionCode: 'BRAND_NEW',
      date: '7/1/26',
      zendeskTicket: '9395',
      trackingNumber: '1ZR096K99051220071',
    }),
    '#9395',
  );
});
