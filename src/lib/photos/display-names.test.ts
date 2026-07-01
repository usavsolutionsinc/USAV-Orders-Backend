import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimsTicketLabel,
  photoExportBaseName,
  photoFileName,
  photoGroupHeaderLabel,
  photoGroupKey,
  photoPrimaryLabel,
  photoShareTitle,
  UNLINKED_PHOTO_GROUP_KEY,
} from '@/lib/photos/display-names';

const claimPhoto = { id: 99, poRef: '14-4421', ticketId: 4821, photoType: 'receiving' };

test('claims scope groups and labels by Zendesk ticket id as #4821', () => {
  assert.equal(photoGroupKey(claimPhoto, 'claims'), 'ticket:4821');
  assert.equal(photoPrimaryLabel(claimPhoto, 'claims'), '#4821');
  assert.equal(photoFileName(claimPhoto, 'claims'), '4821-99.jpg');
  assert.equal(photoGroupHeaderLabel('ticket:4821', 'claims'), '#4821');
  assert.equal(claimsTicketLabel(4821), '#4821');
});

test('unboxing scope keeps PO-based naming even when a ticket link exists', () => {
  assert.equal(photoGroupKey(claimPhoto, 'unboxing'), 'po:14-4421');
  assert.equal(photoPrimaryLabel(claimPhoto, 'unboxing'), 'PO 14-4421');
  assert.equal(photoFileName(claimPhoto, 'unboxing'), 'PO-14-4421-99.jpg');
});

test('claims photos without a ticket link fall into Unlinked', () => {
  const orphan = { id: 1, poRef: 'PO-1', ticketId: null, photoType: null };
  assert.equal(photoGroupKey(orphan, 'claims'), UNLINKED_PHOTO_GROUP_KEY);
  assert.equal(photoGroupHeaderLabel(UNLINKED_PHOTO_GROUP_KEY, 'claims'), 'Unlinked');
});

test('photoExportBaseName prefers ticket id for linked claim photos', () => {
  assert.equal(photoExportBaseName(claimPhoto), '4821');
  assert.equal(photoExportBaseName({ id: 1, poRef: '4421', ticketId: null }), 'PO-4421');
});

test('photoShareTitle uses #ticket in claims scope', () => {
  assert.equal(photoShareTitle([claimPhoto], 'claims'), '#4821 photos (1)');
  assert.equal(photoShareTitle([claimPhoto], 'unboxing'), 'PO 14-4421 photos (1)');
});
