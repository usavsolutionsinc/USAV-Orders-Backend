import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCartonListingLinks } from './listing-links';

test('manual listing URL wins as primary', () => {
  const links = collectCartonListingLinks({
    listingLink: 'https://www.ebay.com/itm/123456789012',
    sku: 'WIDGET-01',
    sourcePlatform: 'ebay',
    isUnmatched: false,
    platforms: [
      {
        platform: 'amazon',
        platformItemId: 'B012345678',
        listingUrl: 'https://www.amazon.com/dp/B012345678',
      },
    ],
  });
  assert.equal(links[0]?.href, 'https://www.ebay.com/itm/123456789012');
  assert.equal(links[0]?.source, 'manual');
  assert.equal(links.length, 3);
});

test('catalog platform for carton source_platform sorts before other catalog rows', () => {
  const links = collectCartonListingLinks({
    listingLink: '',
    sku: 'WIDGET-01',
    sourcePlatform: 'amazon',
    isUnmatched: false,
    platforms: [
      { platform: 'ebay', platformItemId: '123456789012', listingUrl: 'https://www.ebay.com/itm/123456789012' },
      { platform: 'amazon', platformItemId: 'B012345678', listingUrl: 'https://www.amazon.com/dp/B012345678' },
    ],
  });
  assert.equal(links[0]?.href, 'https://www.amazon.com/dp/B012345678');
  assert.equal(links[0]?.source, 'catalog');
});

test('unmatched cartons skip SKU-derived storefront link', () => {
  const links = collectCartonListingLinks({
    listingLink: '',
    sku: 'WIDGET-01',
    sourcePlatform: '',
    isUnmatched: true,
    platforms: [],
  });
  assert.equal(links.length, 0);
});

test('dedupes identical hrefs from catalog and derived paths', () => {
  const links = collectCartonListingLinks({
    listingLink: '',
    sku: '123456789012',
    sourcePlatform: 'ebay',
    isUnmatched: false,
    platforms: [
      { platform: 'ebay', platformItemId: '123456789012', listingUrl: 'https://www.ebay.com/itm/123456789012' },
    ],
  });
  assert.equal(links.length, 1);
  assert.equal(links[0]?.href, 'https://www.ebay.com/itm/123456789012');
});
