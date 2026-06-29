import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZendeskTicketId,
  sellerDraftMatchesTicket,
} from './receiving-claim-seller-ticket-match';

describe('parseZendeskTicketId', () => {
  it('parses hash-prefixed and bare numeric refs', () => {
    assert.equal(parseZendeskTicketId('#9266'), 9266);
    assert.equal(parseZendeskTicketId('9266'), 9266);
    assert.equal(parseZendeskTicketId('https://usav.zendesk.com/agent/tickets/9266'), 9266);
  });

  it('returns null for empty or invalid input', () => {
    assert.equal(parseZendeskTicketId(''), null);
    assert.equal(parseZendeskTicketId('pending'), null);
  });
});

describe('sellerDraftMatchesTicket', () => {
  it('matches when saved and current ticket ids are equal', () => {
    assert.equal(sellerDraftMatchesTicket(9266, 9266, '#9266'), true);
  });

  it('rejects a draft saved for a different ticket on the same line', () => {
    assert.equal(sellerDraftMatchesTicket(5637, 9266, '#9266'), false);
  });

  it('matches via parsed ticket number when ids are partially known', () => {
    assert.equal(sellerDraftMatchesTicket(9266, null, '#9266'), true);
  });

  it('rejects when neither id nor number can be correlated', () => {
    assert.equal(sellerDraftMatchesTicket(null, null, 'pending'), false);
    assert.equal(sellerDraftMatchesTicket(5637, null, 'pending'), false);
  });
});
