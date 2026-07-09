import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('Tech Testing verdict route must not write to Zoho PO notes', async () => {
  // This is a regression guard: Tech Testing verdicts must stay internal-only.
  // The previous leak was caused by POST /api/serial-units/[id]/test calling
  // syncSerialToZohoPo() in an after() block.
  const here = dirname(fileURLToPath(import.meta.url));
  const routePath = join(
    here,
    '..',
    '..',
    'app',
    'api',
    'serial-units',
    '[id]',
    'test',
    'route.ts',
  );

  const src = await readFile(routePath, 'utf8');

  assert.equal(
    src.includes('syncSerialToZohoPo'),
    false,
    'Tech Testing verdict route must not call syncSerialToZohoPo',
  );
  assert.equal(
    src.includes('zoho-serial-sync'),
    false,
    'Tech Testing verdict route must not import zoho-serial-sync',
  );
});

