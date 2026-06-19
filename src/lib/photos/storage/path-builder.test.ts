import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGcsObjectKey } from '../storage/path-builder';

test('buildGcsObjectKey nests receiving photos under org/receiving/YYYY/MM/PO-*', () => {
  const { objectKey, thumbObjectKey } = buildGcsObjectKey({
    organizationId: 'org-123',
    entityType: 'RECEIVING',
    photoId: 99,
    poRef: '4421',
    now: new Date('2026-06-18T12:00:00Z'),
  });
  assert.match(objectKey, /^org-123\/receiving\/2026\/06\/PO-4421\/99\.jpg$/);
  assert.match(thumbObjectKey, /99_thumb\.jpg$/);
});

test('buildGcsObjectKey uses serial-units path for SERIAL_UNIT', () => {
  const { objectKey } = buildGcsObjectKey({
    organizationId: 'org-123',
    entityType: 'SERIAL_UNIT',
    photoId: 7,
    unitUid: 'SKU-2510-000001',
  });
  assert.match(objectKey, /^org-123\/serial-units\/SKU-2510-000001\/7\.jpg$/);
});
