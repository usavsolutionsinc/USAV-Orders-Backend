import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearStructuredPhotoFilters,
  countActivePhotoLibraryFilters,
  formatPhotoLibraryDateRange,
  parsePhotoLibraryFilters,
  photoLibraryFiltersToParams,
  todayFoldersDateFilter,
} from '@/lib/photos/library-filter-state';

test('todayFoldersDateFilter pins both ends to the same PST day', () => {
  const { dateFrom, dateTo } = todayFoldersDateFilter();
  assert.equal(dateFrom, dateTo);
  assert.match(dateFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('parsePhotoLibraryFilters validates source scope and ignores legacy entity params', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('sourceScope=packing&sort=oldest&entityType=RECEIVING&entityId=12'),
  );

  assert.equal(filters.sourceScope, 'packing');
  assert.equal(filters.sort, 'oldest');
  assert.equal((filters as { entityType?: string }).entityType, undefined);
  assert.equal((filters as { entityId?: string }).entityId, undefined);
});

test('photoLibraryFiltersToParams omits default all scope and preserves scoped values', () => {
  const allParams = photoLibraryFiltersToParams({ sourceScope: 'all', poRef: '4421', sort: 'recent' });
  assert.equal(allParams.get('sourceScope'), null);
  assert.equal(allParams.get('sort'), null);
  assert.equal(allParams.get('poRef'), '4421');

  const scopedParams = photoLibraryFiltersToParams({ sourceScope: 'claims', sort: 'oldest', staffId: '7' });
  assert.equal(scopedParams.get('sourceScope'), 'claims');
  assert.equal(scopedParams.get('sort'), 'oldest');
  assert.equal(scopedParams.get('staffId'), '7');
});

test('formatPhotoLibraryDateRange renders explicit custom ranges', () => {
  assert.equal(
    formatPhotoLibraryDateRange({ dateFrom: '2026-06-01', dateTo: '2026-06-03' }),
    'Jun 1 to Jun 3',
  );
});

test('business-ID filters survive the URL round-trip', () => {
  const qs =
    'tracking=1Z999&serial=SN-42&sku=ABC-001&ticketId=12345&pickupId=77&rma=RMA-9';
  const filters = parsePhotoLibraryFilters(new URLSearchParams(qs));
  assert.equal(filters.tracking, '1Z999');
  assert.equal(filters.serial, 'SN-42');
  assert.equal(filters.sku, 'ABC-001');
  assert.equal(filters.ticketId, '12345');
  assert.equal(filters.pickupId, '77');
  assert.equal(filters.rma, 'RMA-9');

  // Re-serializing reproduces every business id (deep-link safe).
  const params = photoLibraryFiltersToParams(filters);
  for (const [key, val] of Object.entries({
    tracking: '1Z999',
    serial: 'SN-42',
    sku: 'ABC-001',
    ticketId: '12345',
    pickupId: '77',
    rma: 'RMA-9',
  })) {
    assert.equal(params.get(key), val);
  }
});

test('business-ID filters count as structured and clear together', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('tracking=1Z999&serial=SN-42&sku=ABC-001&ticketId=5&pickupId=6&rma=RMA-9'),
  );
  // 6 business ids, each counted once.
  assert.equal(countActivePhotoLibraryFilters(filters), 6);

  const cleared = clearStructuredPhotoFilters(filters);
  assert.equal(cleared.tracking, undefined);
  assert.equal(cleared.serial, undefined);
  assert.equal(cleared.sku, undefined);
  assert.equal(cleared.ticketId, undefined);
  assert.equal(cleared.pickupId, undefined);
  assert.equal(cleared.rma, undefined);
  assert.equal(countActivePhotoLibraryFilters(cleared), 0);
});

test('poFinder + kind round-trip, count once, and clear as structured', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('poFinder=SN-42&poFinderKind=serial'),
  );
  assert.equal(filters.poFinder, 'SN-42');
  assert.equal(filters.poFinderKind, 'serial');
  // The finder is one structured refinement regardless of which field it scopes.
  assert.equal(countActivePhotoLibraryFilters(filters), 1);

  // Deep-link safe: value + kind both reproduce.
  const params = photoLibraryFiltersToParams(filters);
  assert.equal(params.get('poFinder'), 'SN-42');
  assert.equal(params.get('poFinderKind'), 'serial');

  const cleared = clearStructuredPhotoFilters(filters);
  assert.equal(cleared.poFinder, undefined);
  assert.equal(cleared.poFinderKind, undefined);
  assert.equal(countActivePhotoLibraryFilters(cleared), 0);
});

test('parsePhotoLibraryFilters rejects an unknown poFinderKind', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('poFinder=4421&poFinderKind=bogus'),
  );
  assert.equal(filters.poFinder, '4421');
  // Invalid kind is dropped; library.ts then defaults the resolution to 'po'.
  assert.equal(filters.poFinderKind, undefined);
});

test('label round-trips through parse + serialize and counts/clears as structured', () => {
  const filters = parsePhotoLibraryFilters(new URLSearchParams('label=defect&imageType=listing'));
  assert.equal(filters.label, 'defect');
  // imageType is a navigator scope (not counted); label is a structured refinement.
  assert.equal(countActivePhotoLibraryFilters(filters), 1);

  const params = photoLibraryFiltersToParams(filters);
  assert.equal(params.get('label'), 'defect');
  assert.equal(params.get('imageType'), 'listing');

  const cleared = clearStructuredPhotoFilters(filters);
  assert.equal(cleared.label, undefined);
  // The image-type navigator survives a structured clear.
  assert.equal(cleared.imageType, 'listing');
  assert.equal(countActivePhotoLibraryFilters(cleared), 0);
});
