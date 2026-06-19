import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPhotoLibraryDateRange,
  parsePhotoLibraryFilters,
  photoLibraryFiltersToParams,
} from '@/lib/photos/library-filter-state';

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
