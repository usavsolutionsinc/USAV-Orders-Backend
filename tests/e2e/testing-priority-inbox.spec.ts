import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * API contract for the shared unbox↔test priority feature + tech-station inbox.
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) created by
 * global-setup, so request.* calls run as the admin staff. Every mutation is
 * restored in a finally block so the suite is idempotent against live data.
 *
 * Covers:
 *   - GET receiving-lines rows expose `is_priority` across views
 *   - PATCH /api/receiving-logs { is_priority } round-trips on the carton
 *   - is_priority floats a carton to rank-0 in view=scanned&sort=priority
 *   - PATCH /api/receiving-lines { needs_test } round-trips (with tech guard)
 *   - GET /api/inbox/tech-queue returns the {items, counts} contract
 */

async function linesFor(request: APIRequestContext, view: string, limit = 50): Promise<any[]> {
  const res = await request.get(`/api/receiving-lines?view=${view}&limit=${limit}`);
  expect(res.ok(), `view=${view}`).toBeTruthy();
  const body = await res.json();
  return body.receiving_lines ?? body.rows ?? [];
}

/** A line whose carton (receiving_id) is set — needed for carton-level patches.
 *  Recent lines are often Zoho-only (no carton yet), so fall through to the
 *  scanned/all feeds which are physical cartons. */
async function lineWithCarton(request: APIRequestContext): Promise<any | null> {
  for (const view of ['scanned', 'recent', 'all']) {
    const hit = (await linesFor(request, view)).find((r) => r.receiving_id != null);
    if (hit) return hit;
  }
  return null;
}

test.describe('testing priority + tech inbox', () => {
  test('receiving-lines rows expose is_priority across views', async ({ request }) => {
    for (const view of ['recent', 'all', 'scanned', 'testing']) {
      const res = await request.get(`/api/receiving-lines?view=${view}&limit=3`);
      expect(res.status(), `view=${view}`).toBe(200);
      const body = await res.json();
      for (const row of body.receiving_lines ?? body.rows ?? []) {
        expect(row, `view=${view} row`).toHaveProperty('is_priority');
      }
    }
  });

  test('receiving-logs PATCH is_priority round-trips on the carton', async ({ request }) => {
    const line = await lineWithCarton(request);
    test.skip(line == null, 'no receiving line with a carton in this environment');
    const cartonId = line.receiving_id;

    const before = await request.get(`/api/receiving-lines?id=${line.id}`);
    const original = Boolean((await before.json()).receiving_line?.is_priority);

    try {
      const patch = await request.patch('/api/receiving-logs', {
        data: { id: cartonId, is_priority: !original },
      });
      expect(patch.status()).toBe(200);

      const after = await request.get(`/api/receiving-lines?id=${line.id}`);
      expect(Boolean((await after.json()).receiving_line?.is_priority)).toBe(!original);
    } finally {
      await request.patch('/api/receiving-logs', { data: { id: cartonId, is_priority: original } });
    }
  });

  test('is_priority floats a carton to rank-0 in the Prioritize sort', async ({ request }) => {
    const res = await request.get('/api/receiving-lines?view=scanned&sort=priority&limit=50');
    expect(res.status()).toBe(200);
    const rows = (await res.json()).receiving_lines ?? [];
    const target = rows.find((r: any) => r.receiving_id != null);
    test.skip(target == null, 'no scanned carton to prioritize in this environment');

    const before = await request.get(`/api/receiving-lines?id=${target.id}`);
    const original = Boolean((await before.json()).receiving_line?.is_priority);

    try {
      const patch = await request.patch('/api/receiving-logs', {
        data: { id: target.receiving_id, is_priority: true },
      });
      expect(patch.status()).toBe(200);

      const sorted = await request.get('/api/receiving-lines?view=scanned&sort=priority&limit=50');
      const sortedRows = (await sorted.json()).receiving_lines ?? [];
      // The flagged carton's line(s) must now lead — the first row is priority.
      expect(Boolean(sortedRows[0]?.is_priority)).toBe(true);
      // And our specific carton sits among the leading priority block.
      const idx = sortedRows.findIndex((r: any) => r.receiving_id === target.receiving_id);
      const firstNonPriority = sortedRows.findIndex((r: any) => !r.is_priority);
      expect(idx).toBeGreaterThanOrEqual(0);
      if (firstNonPriority >= 0) expect(idx).toBeLessThan(firstNonPriority);
    } finally {
      await request.patch('/api/receiving-logs', { data: { id: target.receiving_id, is_priority: original } });
    }
  });

  test('receiving-lines PATCH needs_test round-trips (with tech guard)', async ({ request }) => {
    const line = await lineWithCarton(request);
    test.skip(line == null, 'no receiving line with a carton in this environment');

    const before = await request.get(`/api/receiving-lines?id=${line.id}`);
    const bj = (await before.json()).receiving_line ?? {};
    const original = bj.needs_test !== false;
    const techId = bj.assigned_tech_id ?? 1; // satisfy the clear-guard

    try {
      // Clear (true -> false) — guarded, so pass a tech id.
      const clear = await request.patch('/api/receiving-lines', {
        data: { id: line.id, needs_test: false, assigned_tech_id: techId },
      });
      expect(clear.status()).toBe(200);
      const afterClear = await request.get(`/api/receiving-lines?id=${line.id}`);
      expect((await afterClear.json()).receiving_line?.needs_test).toBe(false);
    } finally {
      await request.patch('/api/receiving-lines', { data: { id: line.id, needs_test: original } });
    }
  });

  test('GET /api/inbox/tech-queue returns the {items, counts} contract', async ({ request }) => {
    const res = await request.get('/api/inbox/tech-queue');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.counts).toBeTruthy();
    expect(body.counts).toHaveProperty('return_pending_test');
    expect(body.counts).toHaveProperty('order_ready_ship');
    for (const it of body.items) {
      expect(['return_pending_test', 'order_ready_ship']).toContain(it.kind);
      expect(it).toHaveProperty('receivingId');
    }
  });
});
