import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sqlLineIdsPhotoCount,
  sqlLinePhotoCount,
  sqlPoLevelPhotoCount,
  sqlReceivingPhotoCount,
} from '@/lib/photos/queries/receiving-list';

test('sqlReceivingPhotoCount counts via photo_entity_links only', () => {
  const sql = sqlReceivingPhotoCount('rl.receiving_id', 'rl.organization_id');
  assert.match(sql, /photo_entity_links/);
  assert.match(sql, /RECEIVING_LINE/);
  assert.match(sql, /rl\.receiving_id/);
  assert.doesNotMatch(sql, /p\.entity_type/);
});

test('sqlPoLevelPhotoCount counts RECEIVING entity only', () => {
  const sql = sqlPoLevelPhotoCount('r.id', 'r.organization_id');
  assert.match(sql, /entity_type = 'RECEIVING'/);
  assert.doesNotMatch(sql, /RECEIVING_LINE/);
});

test('sqlLinePhotoCount counts a single receiving line', () => {
  const sql = sqlLinePhotoCount('rl.id', 'rl.organization_id');
  assert.match(sql, /RECEIVING_LINE/);
  assert.match(sql, /rl\.id/);
});

test('sqlLineIdsPhotoCount accepts int array param', () => {
  const sql = sqlLineIdsPhotoCount('$2::int[]', 'rl.organization_id');
  assert.match(sql, /\$2::int\[\]/);
});
