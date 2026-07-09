import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingLinksFromSyncNotes } from './zoho-po-prefill';

test('parseListingLinksFromSyncNotes extracts multiple Goodwill URLs with titles', () => {
  const notes = [
    'Bose Acoustimass AM-500 Speaker System with Cube & V-100 Video Speaker Black: https://shopgoodwill.com/item/267952401',
    'Bose CineMate 15 Home Theater System Model 415466 Soundbar Subwoofer: https://shopgoodwill.com/item/267830257',
    'Bose Model 141 Speaker - Powers On: https://shopgoodwill.com/item/267831532',
    '(2) Bose Companion 2 Series II Multimedia Speakers: https://shopgoodwill.com/item/268362819',
  ].join('\n');

  const links = parseListingLinksFromSyncNotes(notes);
  assert.equal(links.length, 4);
  assert.deepEqual(
    links.map((l) => l.href),
    [
      'https://shopgoodwill.com/item/267952401',
      'https://shopgoodwill.com/item/267830257',
      'https://shopgoodwill.com/item/267831532',
      'https://shopgoodwill.com/item/268362819',
    ],
  );
  assert.deepEqual(
    links.map((l) => l.title),
    [
      'Bose Acoustimass AM-500 Speaker System with Cube & V-100 Video Speaker Black',
      'Bose CineMate 15 Home Theater System Model 415466 Soundbar Subwoofer',
      'Bose Model 141 Speaker - Powers On',
      '(2) Bose Companion 2 Series II Multimedia Speakers',
    ],
  );
});

test('parseListingLinksFromSyncNotes dedupes identical URLs and trims trailing punctuation', () => {
  const notes = [
    'One: https://shopgoodwill.com/item/267952401,',
    'Dup: https://shopgoodwill.com/item/267952401.',
    'Paren: (https://shopgoodwill.com/item/267952401)',
  ].join('\n');

  const links = parseListingLinksFromSyncNotes(notes);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.href, 'https://shopgoodwill.com/item/267952401');
});

