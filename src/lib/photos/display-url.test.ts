import assert from 'node:assert/strict';
import test from 'node:test';
import { photoContentUrl, resolvePhotoDisplayUrl } from '@/lib/photos/display-url';

test('photoContentUrl builds id-based content routes', () => {
  assert.equal(photoContentUrl(42), '/api/photos/42/content');
  assert.equal(photoContentUrl(42, 'thumb'), '/api/photos/42/content?variant=thumb');
});

test('resolvePhotoDisplayUrl prefers content route when id is known', () => {
  assert.equal(resolvePhotoDisplayUrl({ id: 5, url: 'http://legacy/nas.jpg' }), '/api/photos/5/content');
});
