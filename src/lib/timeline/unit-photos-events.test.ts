import test from 'node:test';
import assert from 'node:assert/strict';
import { unitPhotosToTimeline, type UnitTimelinePhotoRow } from './unit-photos-events';

function row(overrides: Partial<UnitTimelinePhotoRow> = {}): UnitTimelinePhotoRow {
  return {
    photoId: 1,
    at: '2026-06-15T12:00:00.000Z',
    source: 'testing',
    thumbUrl: '/api/photos/1/content?variant=thumb',
    fullUrl: '/api/photos/1/content',
    ...overrides,
  };
}

test('groups photos into one row per source with the right title + tone', () => {
  const items = unitPhotosToTimeline([
    row({ photoId: 1, source: 'testing' }),
    row({ photoId: 2, source: 'unbox' }),
    row({ photoId: 3, source: 'testing' }),
  ]);

  assert.equal(items.length, 2);
  const testing = items.find((i) => i.id === 'unit-photos-testing');
  const unbox = items.find((i) => i.id === 'unit-photos-unbox');

  assert.ok(testing);
  assert.equal(testing!.title, 'Testing photos');
  assert.equal(testing!.tone, 'info');
  assert.equal(testing!.subtitle, '2 photos');
  assert.equal(testing!.media?.length, 2);

  assert.ok(unbox);
  assert.equal(unbox!.title, 'Unboxing photos');
  assert.equal(unbox!.tone, 'muted');
  assert.equal(unbox!.subtitle, '1 photo');
});

test('attaches each photo as media (photoId + thumb + full)', () => {
  const [item] = unitPhotosToTimeline([
    row({ photoId: 42, thumbUrl: '/t/42', fullUrl: '/f/42' }),
  ]);
  assert.deepEqual(item.media, [{ photoId: 42, thumbUrl: '/t/42', fullUrl: '/f/42' }]);
});

test('row timestamp is the newest capture in the source group', () => {
  const [item] = unitPhotosToTimeline([
    row({ photoId: 1, at: '2026-06-15T10:00:00.000Z' }),
    row({ photoId: 2, at: '2026-06-15T14:00:00.000Z' }),
    row({ photoId: 3, at: '2026-06-15T09:00:00.000Z' }),
  ]);
  assert.equal(item.at, '2026-06-15T14:00:00.000Z');
});

test('empty input yields no rows', () => {
  assert.deepEqual(unitPhotosToTimeline([]), []);
});
