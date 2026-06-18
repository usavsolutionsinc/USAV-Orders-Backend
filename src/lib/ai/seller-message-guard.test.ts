import { describe, expect, it } from 'vitest';
import {
  sanitizeSellerMessage,
  sellerMessageHasLinks,
  stripLinksFromSellerMessage,
} from './seller-message-guard';

describe('seller-message-guard', () => {
  it('detects http and www links', () => {
    expect(sellerMessageHasLinks('See https://example.com/path for photos')).toBe(true);
    expect(sellerMessageHasLinks('Visit www.ebay.com/itm/123')).toBe(true);
  });

  it('detects bare domain paths', () => {
    expect(sellerMessageHasLinks('Details at ebay.com/itm/12345')).toBe(true);
  });

  it('leaves plain text untouched', () => {
    const msg = 'Hello,\n\nWe received a damage issue. PO: 1015.\n\nThank you.';
    expect(sellerMessageHasLinks(msg)).toBe(false);
    expect(sanitizeSellerMessage(msg)).toEqual({ message: msg, linksStripped: false });
  });

  it('strips links from seller output', () => {
    const out = stripLinksFromSellerMessage('Photos: https://usav.app/receiving/1 — thanks');
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).toContain('[link removed]');
  });
});
