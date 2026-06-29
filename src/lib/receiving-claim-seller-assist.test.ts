import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicSellerMessage } from './receiving-claim-seller-assist';

describe('buildDeterministicSellerMessage', () => {
  it('includes the filed Zendesk ticket number as plain text', () => {
    const msg = buildDeterministicSellerMessage({
      claimType: 'damage',
      reason: 'Dented corner',
      description: [
        'Purchase Order: PO-1015',
        'Tracking: 1Z999',
        'Item: Bose 700',
      ].join('\n'),
      zendeskTicketNumber: '#5637',
    });
    assert.ok(msg.includes('Our case reference: #5637'));
    assert.ok(msg.includes('PO-1015'));
    assert.ok(!msg.includes('Severity:'));
    assert.doesNotMatch(msg, /https?:\/\//);
  });
});
