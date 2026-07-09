import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGcsObjectKey } from '../storage/path-builder';
import { slugifyImageType } from '../image-types';

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

test('a custom image-type prefix replaces the entity flow, keeping the PO segment', () => {
  const { objectKey, thumbObjectKey } = buildGcsObjectKey({
    organizationId: 'org-123',
    entityType: 'RECEIVING',
    photoId: 7,
    poRef: '12345',
    prefix: 'damage-closeups',
    now: new Date('2026-06-24T12:00:00Z'),
  });
  assert.equal(objectKey, 'org-123/damage-closeups/2026/06/PO-12345/7.jpg');
  assert.equal(thumbObjectKey, 'org-123/damage-closeups/2026/06/PO-12345/7_thumb.jpg');
});

test('a custom prefix drops the PO segment when there is no poRef', () => {
  const { objectKey } = buildGcsObjectKey({
    organizationId: 'org-123',
    entityType: 'SERIAL_UNIT',
    photoId: 5,
    poRef: null,
    prefix: 'qc',
    now: new Date('2026-06-24T12:00:00Z'),
  });
  assert.equal(objectKey, 'org-123/qc/2026/06/5.jpg');
});

test('slugifyImageType lowercases, hyphenates, trims, and falls back', () => {
  assert.equal(slugifyImageType('Damage Close-ups'), 'damage-close-ups');
  assert.equal(slugifyImageType('  QC / Defects!! '), 'qc-defects');
  assert.equal(slugifyImageType('***'), 'type');
});
