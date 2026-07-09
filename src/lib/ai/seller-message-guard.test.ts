import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSellerMessage,
  sellerMessageHasLinks,
  stripLinksFromSellerMessage,
} from './seller-message-guard';

describe('seller-message-guard', () => {
  it('detects http and www links', () => {
    assert.equal(sellerMessageHasLinks('See https://example.com/path for photos'), true);
    assert.equal(sellerMessageHasLinks('Visit www.ebay.com/itm/123'), true);
  });

  it('detects bare domain paths', () => {
    assert.equal(sellerMessageHasLinks('Details at ebay.com/itm/12345'), true);
  });

  it('leaves plain text untouched', () => {
    const msg = 'Hello,\n\nWe received a damage issue. PO: 1015.\n\nThank you.';
    assert.equal(sellerMessageHasLinks(msg), false);
    assert.deepEqual(sanitizeSellerMessage(msg), { message: msg, linksStripped: false });
  });

  it('strips links from seller output', () => {
    const out = stripLinksFromSellerMessage('Photos: https://usav.app/receiving/1 — thanks');
    assert.doesNotMatch(out, /https?:\/\//);
    assert.ok(out.includes('[link removed]'));
  });
});
