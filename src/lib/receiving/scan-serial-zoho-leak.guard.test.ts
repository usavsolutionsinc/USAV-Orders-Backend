import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

test('Receiving scan-serial route must not write to Zoho', async () => {
  // Regression guard: serial scans are sidecar metadata and must remain local.
  // Zoho PO updates (serials in descriptions / PO notes) should happen only when
  // the operator presses Receive in Unbox.
  const here = dirname(fileURLToPath(import.meta.url));
  const routePath = join(
    here,
    '..',
    '..',
    'app',
    'api',
    'receiving',
    'scan-serial',
    'route.ts',
  );

  const src = await readFile(routePath, 'utf8');

  assert.equal(
    src.includes('syncSerialToZohoPo'),
    false,
    'scan-serial route must not call syncSerialToZohoPo',
  );
  assert.equal(
    src.includes('zoho-serial-sync'),
    false,
    'scan-serial route must not import zoho-serial-sync',
  );
});

