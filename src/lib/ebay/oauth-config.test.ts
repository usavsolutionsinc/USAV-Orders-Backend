/**
 * Unit tests for the eBay OAuth scope/environment single source of truth.
 * Runs with the existing `tsx --test` harness — no extra deps, no DB.
 */
import { test, afterEach } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import {
  ebayScopes,
  ebayScopeString,
  normalizeEbayEnvironment,
  isEbaySandbox,
  ebayAuthDomain,
  ebayTokenEndpoint,
  ebayIdentityEndpoint,
} from './oauth-config';

afterEach(() => {
  delete process.env.EBAY_SCOPES;
});

test('default scopes are the minimal seller-copilot set (no sell.finances)', () => {
  delete process.env.EBAY_SCOPES;
  const scopes = ebayScopes();
  ok(scopes.includes('https://api.ebay.com/oauth/api_scope'));
  ok(scopes.includes('https://api.ebay.com/oauth/api_scope/sell.inventory'));
  ok(scopes.includes('https://api.ebay.com/oauth/api_scope/sell.fulfillment'));
  ok(scopes.includes('https://api.ebay.com/oauth/api_scope/sell.account'));
  ok(!scopes.some((s) => s.endsWith('/sell.finances')), 'sell.finances must be opt-in');
});

test('EBAY_SCOPES overrides the default set (space-separated)', () => {
  process.env.EBAY_SCOPES =
    'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.finances';
  deepStrictEqual(ebayScopes(), [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.finances',
  ]);
});

test('blank EBAY_SCOPES falls back to defaults', () => {
  process.env.EBAY_SCOPES = '   ';
  ok(ebayScopes().length >= 4);
});

test('ebayScopeString joins with a single space', () => {
  process.env.EBAY_SCOPES = 'a b';
  strictEqual(ebayScopeString(), 'a b');
});

test('normalizeEbayEnvironment defaults to PRODUCTION and is case-insensitive', () => {
  strictEqual(normalizeEbayEnvironment(undefined), 'PRODUCTION');
  strictEqual(normalizeEbayEnvironment(''), 'PRODUCTION');
  strictEqual(normalizeEbayEnvironment('PRODUCTION'), 'PRODUCTION');
  strictEqual(normalizeEbayEnvironment('garbage'), 'PRODUCTION');
  strictEqual(normalizeEbayEnvironment('SANDBOX'), 'SANDBOX');
  strictEqual(normalizeEbayEnvironment('sandbox'), 'SANDBOX');
  strictEqual(normalizeEbayEnvironment(' Sandbox '), 'SANDBOX');
});

test('endpoints are environment-aware', () => {
  strictEqual(isEbaySandbox('SANDBOX'), true);
  strictEqual(isEbaySandbox('PRODUCTION'), false);

  strictEqual(ebayAuthDomain('SANDBOX'), 'auth.sandbox.ebay.com');
  strictEqual(ebayAuthDomain('PRODUCTION'), 'auth.ebay.com');

  strictEqual(ebayTokenEndpoint('SANDBOX'), 'https://api.sandbox.ebay.com/identity/v1/oauth2/token');
  strictEqual(ebayTokenEndpoint('PRODUCTION'), 'https://api.ebay.com/identity/v1/oauth2/token');

  strictEqual(ebayIdentityEndpoint('SANDBOX'), 'https://api.sandbox.ebay.com/commerce/identity/v1/user/');
  strictEqual(ebayIdentityEndpoint('PRODUCTION'), 'https://api.ebay.com/commerce/identity/v1/user/');
});
