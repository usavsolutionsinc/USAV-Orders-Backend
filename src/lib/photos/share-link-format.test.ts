import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShareLinksText, formatUriList } from '@/lib/photos/share-link-format';

test('formatShareLinksText returns a bare URL for a single link', () => {
  const text = formatShareLinksText([{ filename: 'PO-1-01.jpg', url: 'https://x/a' }]);
  assert.equal(text, 'https://x/a');
});

test('formatShareLinksText labels each line for multiple links', () => {
  const text = formatShareLinksText([
    { filename: 'PO-1-01.jpg', url: 'https://x/a' },
    { filename: 'PO-1-02.jpg', url: 'https://x/b' },
  ]);
  assert.equal(text, 'PO-1-01.jpg: https://x/a\nPO-1-02.jpg: https://x/b');
});

test('formatShareLinksText prepends a group header and appends an expiry note', () => {
  const text = formatShareLinksText(
    [{ filename: 'PO-1-01.jpg', url: 'https://x/a' }],
    { groupUrl: 'https://x/share/tok', expiresInLabel: '24 hours' },
  );
  assert.equal(
    text,
    'Photos (1): https://x/share/tok\n\nPO-1-01.jpg: https://x/a\n\nLinks expire in 24 hours.',
  );
});

test('formatShareLinksText returns empty string for no links', () => {
  assert.equal(formatShareLinksText([]), '');
});

test('formatUriList joins URLs one per line', () => {
  assert.equal(
    formatUriList([
      { filename: 'a', url: 'https://x/a' },
      { filename: 'b', url: 'https://x/b' },
    ]),
    'https://x/a\nhttps://x/b',
  );
});
