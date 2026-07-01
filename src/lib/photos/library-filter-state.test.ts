import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearStructuredPhotoFilters,
  countActivePhotoLibraryFilters,
  defaultPhotoLibraryMediaTypePatch,
  fieldForFinderKind,
  formatPhotoLibraryDateRange,
  isPhotoLibraryMediaTypeUnset,
  parsePhotoLibraryFilters,
  photoLibraryFiltersToParams,
  todayFoldersDateFilter,
  DEFAULT_PHOTO_LIBRARY_MEDIA_SCOPE,
  PHOTO_LIBRARY_VIEW_ORDER,
  PHOTO_LIBRARY_PAGE_SIZE,
  type PhotoLibraryViewMode,
} from '@/lib/photos/library-filter-state';

test('todayFoldersDateFilter pins both ends to the same PST day', () => {
  const { dateFrom, dateTo } = todayFoldersDateFilter();
  assert.equal(dateFrom, dateTo);
  assert.match(dateFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('parsePhotoLibraryFilters supports outbound scope and documentType', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('sourceScope=outbound&documentType=shipping_label&poRef=ORD-1'),
  );
  assert.equal(filters.sourceScope, 'outbound');
  assert.equal(filters.documentType, 'shipping_label');
  assert.equal(filters.poRef, 'ORD-1');
});

test('photoLibraryFiltersToParams serializes outbound documentType', () => {
  const params = photoLibraryFiltersToParams({
    sourceScope: 'outbound',
    documentType: 'packing_slip',
  });
  assert.equal(params.get('sourceScope'), 'outbound');
  assert.equal(params.get('documentType'), 'packing_slip');
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

test('business-ID filters clear together but do not count toward the filter badge', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('tracking=1Z999&serial=SN-42&sku=ABC-001&ticketId=5&pickupId=6&rma=RMA-9'),
  );
  assert.equal(countActivePhotoLibraryFilters(filters), 0);

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

test('poFinder ticket kind round-trips in URL params', () => {
  const filters = parsePhotoLibraryFilters(
    new URLSearchParams('sourceScope=claims&poFinder=4821&poFinderKind=ticket'),
  );
  assert.equal(filters.sourceScope, 'claims');
  assert.equal(filters.poFinder, '4821');
  assert.equal(filters.poFinderKind, 'ticket');
  assert.equal(fieldForFinderKind('ticket'), 'ticket');

  const params = photoLibraryFiltersToParams(filters);
  assert.equal(params.get('poFinder'), '4821');
  assert.equal(params.get('poFinderKind'), 'ticket');
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

test('PHOTO_LIBRARY_VIEW_ORDER lists the 5 view modes, unique, for the 1–5 shortcuts', () => {
  assert.equal(PHOTO_LIBRARY_VIEW_ORDER.length, 5);
  assert.equal(new Set(PHOTO_LIBRARY_VIEW_ORDER).size, 5);
  const valid: PhotoLibraryViewMode[] = ['grid-sm', 'grid-lg', 'grid-ticket', 'folders', 'list'];
  for (const mode of PHOTO_LIBRARY_VIEW_ORDER) assert.ok(valid.includes(mode));
  // The digit shortcuts read position — folders is the 3rd option (key "3").
  assert.equal(PHOTO_LIBRARY_VIEW_ORDER[2], 'folders');
});

test('PHOTO_LIBRARY_PAGE_SIZE matches the server request (no 24-vs-48 drift)', () => {
  assert.equal(PHOTO_LIBRARY_PAGE_SIZE, 48);
});

test('a saved-view filter snapshot round-trips through parse + serialize', () => {
  // Mirrors the media saved-view payload: an arbitrary filter set is restored
  // verbatim when applied (replaceFilters) after being stored in JSONB.
  const snapshot = parsePhotoLibraryFilters(
    new URLSearchParams('sourceScope=claims&label=defect&poFinder=14-123&poFinderKind=po'),
  );
  const params = photoLibraryFiltersToParams(snapshot);
  const restored = parsePhotoLibraryFilters(params);
  assert.deepEqual(restored, snapshot);
});

test('default media type targets the first built-in scope and is separate from structured filters', () => {
  assert.equal(DEFAULT_PHOTO_LIBRARY_MEDIA_SCOPE, 'unboxing');
  assert.equal(isPhotoLibraryMediaTypeUnset({}), true);
  assert.equal(isPhotoLibraryMediaTypeUnset({ sourceScope: 'all' }), true);
  assert.equal(isPhotoLibraryMediaTypeUnset({ sourceScope: 'packing' }), false);
  assert.equal(isPhotoLibraryMediaTypeUnset({ imageType: 'listing' }), false);

  const patch = defaultPhotoLibraryMediaTypePatch();
  assert.equal(patch.sourceScope, 'unboxing');
  assert.equal(patch.imageType, undefined);
  assert.equal(patch.dateFrom, patch.dateTo);

  const withStructured = parsePhotoLibraryFilters(
    new URLSearchParams('sourceScope=unboxing&poFinder=SN-1&dateFrom=2026-01-01'),
  );
  const cleared = clearStructuredPhotoFilters(withStructured);
  assert.equal(cleared.sourceScope, 'unboxing');
  assert.equal(countActivePhotoLibraryFilters(cleared), 0);
});
