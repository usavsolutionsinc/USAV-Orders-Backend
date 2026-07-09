import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Receiving-line API contract — guards against regressions from schema changes
 * (added the `zendesk_ticket` column in 2026-06-02_receiving_zendesk_ticket.sql).
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) created by
 * global-setup, so request.* calls are authenticated as the admin staff.
 *
 * Covers:
 *   - GET list across every `view` branch
 *   - GET single (+ include=serials) and GET package (?receiving_id)
 *   - every row exposes the `zendesk_ticket` key
 *   - PATCH zendesk_ticket round-trips and is restored afterwards
 */

async function firstLine(request: APIRequestContext) {
  const res = await request.get('/api/receiving-lines?view=recent&limit=10');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const rows: any[] = body.receiving_lines ?? body.rows ?? [];
  return rows;
}

test.describe('receiving-lines endpoints', () => {
  test('GET list works for every receiving view and exposes zendesk_ticket', async ({ request }) => {
    for (const view of ['recent', 'all', 'incoming', 'received', 'activity']) {
      const res = await request.get(`/api/receiving-lines?view=${view}&limit=3`);
      expect(res.status(), `view=${view}`).toBe(200);
      const body = await res.json();
      expect(body.success, `view=${view}`).toBe(true);
      for (const row of (body.receiving_lines ?? body.rows ?? [])) {
        expect(row, `view=${view} row`).toHaveProperty('zendesk_ticket');
      }
    }
  });

  test('GET receiving-lines rejects testing views (isolated endpoint)', async ({ request }) => {
    for (const view of ['testing', 'needs-test']) {
      const res = await request.get(`/api/receiving-lines?view=${view}&limit=3`);
      expect(res.status(), `view=${view}`).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('TESTING_VIEW_NOT_ALLOWED');
    }
  });

  test('GET testing/receiving-lines serves testing views only', async ({ request }) => {
    const bad = await request.get('/api/testing/receiving-lines?view=recent&limit=3');
    expect(bad.status()).toBe(400);
    const ok = await request.get('/api/testing/receiving-lines?view=testing&limit=3');
    expect(ok.status()).toBe(200);
  });

  test('GET single + package include the new column', async ({ request }) => {
    const rows = await firstLine(request);
    test.skip(rows.length === 0, 'no receiving lines in this environment');

    const single = await request.get(`/api/receiving-lines?id=${rows[0].id}`);
    expect(single.status()).toBe(200);
    const sj = await single.json();
    expect(sj.success).toBe(true);
    expect(sj.receiving_line).toHaveProperty('zendesk_ticket');

    const withSerials = await request.get(`/api/receiving-lines?id=${rows[0].id}&include=serials`);
    expect(withSerials.status()).toBe(200);

    const pkgRow = rows.find((r) => r.receiving_id != null);
    if (pkgRow) {
      const pkg = await request.get(`/api/receiving-lines?receiving_id=${pkgRow.receiving_id}`);
      expect(pkg.status()).toBe(200);
      expect((await pkg.json()).success).toBe(true);
    }
  });

  test('PATCH zendesk_ticket round-trips (and is restored)', async ({ request }) => {
    const rows = await firstLine(request);
    test.skip(rows.length === 0, 'no receiving lines in this environment');
    const id = rows[0].id;

    const before = await request.get(`/api/receiving-lines?id=${id}`);
    const original = (await before.json()).receiving_line?.zendesk_ticket ?? null;
    const sentinel = '#E2E_SMOKE_999';

    try {
      const patch = await request.patch('/api/receiving-lines', { data: { id, zendesk_ticket: sentinel } });
      expect(patch.status()).toBe(200);
      const pj = await patch.json();
      expect(pj.success).toBe(true);
      expect(pj.receiving_line?.zendesk_ticket).toBe(sentinel);

      const after = await request.get(`/api/receiving-lines?id=${id}`);
      expect((await after.json()).receiving_line?.zendesk_ticket).toBe(sentinel);
    } finally {
      // Always restore the original value so the test is idempotent.
      await request.patch('/api/receiving-lines', { data: { id, zendesk_ticket: original } });
    }
  });
});
