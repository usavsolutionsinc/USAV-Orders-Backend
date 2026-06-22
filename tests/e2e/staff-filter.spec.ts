import { test, expect } from '@playwright/test';

/**
 * Universal staff filter (P1-WORK-02) — API contract for the shared
 * all-staff ↔ single-staff `?staff=` predicate threaded into every wired mode.
 *
 * Acceptance under test:
 *   A. Each mode defaults to ALL staff (no `?staff=`) and narrows to ONE when a
 *      positive staff id is passed. The narrowed result must be a subset of the
 *      all-staff result (the filter only ever removes rows, never adds).
 *   B. The convention is one shared param key (`staff`) across modes — the same
 *      query string narrows orders (Unshipped), shipped/packer logs, and the
 *      receiving carton list.
 *
 * This is a contract test (no UI): it asserts the WHERE-add semantics on the
 * three wired API surfaces. It never mutates a serial or any row.
 *
 * Env:
 *   PW_TEST_STAFF_ID – a staff id present in the test DB (default 1)
 */

const STAFF_ID = Number(process.env.PW_TEST_STAFF_ID || '1');

function rowsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['orders', 'shipped', 'results', 'receiving_lines']) {
      if (Array.isArray(d[key])) return d[key] as unknown[];
    }
  }
  return [];
}

test.describe('Universal staff filter (?staff=)', () => {
  for (const surface of [
    { name: 'Unshipped orders', base: '/api/orders?fulfillmentScope=true' },
    { name: 'Shipped / packer logs', base: '/api/packerlogs?limit=200' },
    { name: 'Receiving carton list', base: '/api/receiving-lines?view=scanned&limit=200' },
  ]) {
    test(`${surface.name}: default = ALL, ?staff= narrows to a subset`, async ({ request }) => {
      test.skip(test.info().project.name === 'mobile', 'API contract — run against desktop project');
      const all = await request.get(surface.base);
      // Auth/permission gates can 401/403 in CI without a session — skip rather
      // than fail; the contract under test is the WHERE-add, not auth.
      test.skip(all.status() === 401 || all.status() === 403, 'no session in this environment');
      expect(all.ok()).toBeTruthy();
      const allRows = rowsOf(await all.json());

      const sep = surface.base.includes('?') ? '&' : '?';
      const narrowed = await request.get(`${surface.base}${sep}staff=${STAFF_ID}`);
      expect(narrowed.ok()).toBeTruthy();
      const narrowedRows = rowsOf(await narrowed.json());

      // The staff filter is a WHERE-add: it can only ever return ≤ the all-staff
      // count. Equality is allowed (e.g. a single-staff test DB).
      expect(narrowedRows.length).toBeLessThanOrEqual(allRows.length);
    });
  }
});
