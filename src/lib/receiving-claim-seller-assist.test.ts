import { describe, expect, it } from 'vitest';
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
    expect(msg).toContain('Our case reference: #5637');
    expect(msg).toContain('PO-1015');
    expect(msg).not.toContain('Severity:');
    expect(msg).not.toMatch(/https?:\/\//);
  });
});
