import { describe, expect, it } from 'vitest';
import {
  parseZendeskTicketId,
  sellerDraftMatchesTicket,
} from './receiving-claim-seller-ticket-match';

describe('parseZendeskTicketId', () => {
  it('parses hash-prefixed and bare numeric refs', () => {
    expect(parseZendeskTicketId('#9266')).toBe(9266);
    expect(parseZendeskTicketId('9266')).toBe(9266);
    expect(parseZendeskTicketId('https://usav.zendesk.com/agent/tickets/9266')).toBe(9266);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseZendeskTicketId('')).toBeNull();
    expect(parseZendeskTicketId('pending')).toBeNull();
  });
});

describe('sellerDraftMatchesTicket', () => {
  it('matches when saved and current ticket ids are equal', () => {
    expect(sellerDraftMatchesTicket(9266, 9266, '#9266')).toBe(true);
  });

  it('rejects a draft saved for a different ticket on the same line', () => {
    expect(sellerDraftMatchesTicket(5637, 9266, '#9266')).toBe(false);
  });

  it('matches via parsed ticket number when ids are partially known', () => {
    expect(sellerDraftMatchesTicket(9266, null, '#9266')).toBe(true);
  });

  it('rejects when neither id nor number can be correlated', () => {
    expect(sellerDraftMatchesTicket(null, null, 'pending')).toBe(false);
    expect(sellerDraftMatchesTicket(5637, null, 'pending')).toBe(false);
  });
});
