import test from 'node:test';
import assert from 'node:assert/strict';

import { accountsDomain, buildZohoUrl, getInventoryBaseUrl } from './url';

test('accountsDomain defaults to .com when missing/blank', () => {
  assert.equal(accountsDomain({}), 'accounts.zoho.com');
  assert.equal(accountsDomain({ domain: '   ' }), 'accounts.zoho.com');
  assert.equal(accountsDomain({ domain: 'accounts.zoho.eu' }), 'accounts.zoho.eu');
});

test('getInventoryBaseUrl maps each data center', () => {
  assert.equal(getInventoryBaseUrl({ orgId: '1' }), 'https://www.zohoapis.com/inventory/v1');
  assert.equal(getInventoryBaseUrl({ orgId: '1', domain: 'accounts.zoho.eu' }), 'https://www.zohoapis.eu/inventory/v1');
  assert.equal(getInventoryBaseUrl({ orgId: '1', domain: 'accounts.zoho.in' }), 'https://www.zohoapis.in/inventory/v1');
  assert.equal(getInventoryBaseUrl({ orgId: '1', domain: 'accounts.zoho.com.au' }), 'https://www.zohoapis.com.au/inventory/v1');
  assert.equal(getInventoryBaseUrl({ orgId: '1', domain: 'accounts.zoho.ca' }), 'https://www.zohoapis.ca/inventory/v1');
  assert.equal(getInventoryBaseUrl({ orgId: '1', domain: 'accounts.zoho.jp' }), 'https://www.zohoapis.jp/inventory/v1');
});

test('buildZohoUrl uses the tenant Zoho org id as organization_id', () => {
  const url = new URL(buildZohoUrl('/purchaseorders', {}, { orgId: 'ZORG_777' }));
  assert.equal(url.pathname, '/inventory/v1/purchaseorders');
  assert.equal(url.searchParams.get('organization_id'), 'ZORG_777');
});

test('buildZohoUrl strips a legacy /api/v1 prefix', () => {
  const url = new URL(buildZohoUrl('/api/v1/items', {}, { orgId: '5' }));
  assert.equal(url.pathname, '/inventory/v1/items');
});

test('buildZohoUrl appends query and omits empty/null/undefined values', () => {
  const url = new URL(
    buildZohoUrl('/bills', { purchaseorder_id: 'PO1', page: 2, blank: '', n: null, u: undefined }, { orgId: '9' }),
  );
  assert.equal(url.searchParams.get('purchaseorder_id'), 'PO1');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.has('blank'), false);
  assert.equal(url.searchParams.has('n'), false);
  assert.equal(url.searchParams.has('u'), false);
});

test('buildZohoUrl honors the data center', () => {
  const url = buildZohoUrl('/warehouses', {}, { orgId: '3', domain: 'accounts.zoho.eu' });
  assert.ok(url.startsWith('https://www.zohoapis.eu/inventory/v1/warehouses?'), url);
});
