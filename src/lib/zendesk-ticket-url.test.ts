/**
 * zendeskTicketUrl — deep-link builder used to make ticket numbers clickable
 * across the receiving + support UIs. Pure/env-driven, so it's safe to unit test.
 */
import { test } from 'node:test';
import { strictEqual } from 'node:assert';

// Deterministic subdomain regardless of the ambient shell env.
process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN = 'usav';
process.env.ZENDESK_SUBDOMAIN = 'usav';

import { zendeskTicketUrl } from './zendesk-ticket-url';

test('builds an agent ticket URL from a numeric id', () => {
  strictEqual(zendeskTicketUrl(123), 'https://usav.zendesk.com/agent/tickets/123');
});

test('strips a leading # and surrounding whitespace', () => {
  strictEqual(zendeskTicketUrl('  #456 '), 'https://usav.zendesk.com/agent/tickets/456');
});

test('passes through an already-full URL (operator paste)', () => {
  strictEqual(
    zendeskTicketUrl('https://acme.zendesk.com/agent/tickets/9'),
    'https://acme.zendesk.com/agent/tickets/9',
  );
});

test('returns null for free-text notes and empty/nullish input', () => {
  strictEqual(zendeskTicketUrl('see support notes'), null);
  strictEqual(zendeskTicketUrl(''), null);
  strictEqual(zendeskTicketUrl(null), null);
  strictEqual(zendeskTicketUrl(undefined), null);
});
