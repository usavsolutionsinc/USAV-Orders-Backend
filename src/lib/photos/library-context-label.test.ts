import assert from 'node:assert/strict';
import test from 'node:test';
import { describePhotoLibraryContext } from '@/lib/photos/library-context-label';

test('describePhotoLibraryContext prefers the source scope title when no narrower filter is set', () => {
  const { title, subtitle } = describePhotoLibraryContext({ sourceScope: 'claims' });

  assert.equal(title, 'Zendesk Claims');
  assert.equal(subtitle, 'Browse receiving, packing, and unit photos');
});
