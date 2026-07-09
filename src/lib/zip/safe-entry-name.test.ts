import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeZipEntryName,
  safeZipDownloadBasename,
  uniquifyZipEntryNames,
  zipAttachmentHeaders,
} from './safe-entry-name';

test('safeZipEntryName strips path segments and illegal chars', () => {
  assert.equal(safeZipEntryName('folder\\photo #1.jpg', 'photo.jpg'), 'photo_1.jpg');
  assert.equal(safeZipEntryName('a/b/c.png', 'x.png'), 'c.png');
  assert.equal(safeZipEntryName('  ..scary..  ', 'fallback.jpg'), 'scary');
});

test('safeZipEntryName rejects Windows reserved device names', () => {
  assert.equal(safeZipEntryName('CON', 'photo.jpg'), 'photo.jpg');
  assert.equal(safeZipEntryName('nul.txt', 'photo.jpg'), 'photo.jpg');
  assert.equal(safeZipEntryName('COM1.jpg', 'photo.jpg'), 'photo.jpg');
  assert.equal(safeZipEntryName('lpt9', 'fallback'), 'fallback');
});

test('safeZipDownloadBasename is ASCII and length-capped', () => {
  assert.equal(safeZipDownloadBasename('PO 1234 / photos!!'), 'PO_1234_photos');
  assert.equal(safeZipDownloadBasename(''), 'photos');
  assert.ok(safeZipDownloadBasename('x'.repeat(80)).length <= 40);
});

test('uniquifyZipEntryNames avoids Windows overwrite collisions', () => {
  assert.deepEqual(uniquifyZipEntryNames(['a.jpg', 'a.jpg', 'b.jpg', 'A.JPG']), [
    'a.jpg',
    'a_2.jpg',
    'b.jpg',
    'A_3.JPG',
  ]);
});

test('zipAttachmentHeaders include length + disposition', () => {
  const headers = zipAttachmentHeaders('My Photos', 2048) as Record<string, string>;
  assert.equal(headers['content-type'], 'application/zip');
  assert.equal(headers['content-length'], '2048');
  assert.equal(headers['content-disposition'], 'attachment; filename="My_Photos.zip"');
});
