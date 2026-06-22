import { test, expect } from '@playwright/test';

/**
 * Order timeline — API contract for the universal timeline (P1-TRACE-02).
 *
 * The shared `EventTimeline` in every order detail panel is fed by
 * `GET /api/orders/[id]/timeline`, which merges three spines from P0-TRACE-01:
 *   • `events`        — order-anchored audit_logs (actor_name + created_at)
 *   • `lifecycle`     — the inventory_events spine via readInventorySpine
 *                       (actor_name + occurred_at + serial_number → serial view)
 *   • `stationEvents` — SAL TECH/OUTBOUND scans (actor_name + created_at)
 *
 * This asserts the contract the component relies on: every spine row that exists
 * carries an actor field and a timestamp (acceptance A), and lifecycle rows
 * expose a serial identifier so the serial↔order toggle has something to group
 * by (acceptance B). Org-scoping (acceptance C) is enforced by the route's
 * ownership pre-flight; a foreign/unknown id must 404, never leak.
 *
 * Env:
 *   PW_TEST_ORDER_ID – integer id of an order row in the test DB (default 1)
 */

const ORDER_ID = Number(process.env.PW_TEST_ORDER_ID || '1');

test.describe('Order timeline API', () => {
  test('GET /api/orders/[id]/timeline returns actor+timestamp spines', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    const res = await request.get(`/api/orders/${ORDER_ID}/timeline`);
    expect(res.ok(), `timeline GET failed with ${res.status()}`).toBeTruthy();

    const json = await res.json();
    expect(json.success).toBeTruthy();
    expect(Array.isArray(json.events)).toBeTruthy();
    expect(Array.isArray(json.lifecycle)).toBeTruthy();
    expect(Array.isArray(json.stationEvents)).toBeTruthy();

    // Acceptance A — every audit row carries a timestamp and an actor slot.
    for (const e of json.events ?? []) {
      expect(e).toHaveProperty('created_at');
      expect(e).toHaveProperty('actor_name'); // may be null for system actions
    }

    // Acceptance A + B — lifecycle (inventory_events spine) carries actor +
    // timestamp + the serial identifier the serial-based view groups on.
    for (const l of json.lifecycle ?? []) {
      expect(l).toHaveProperty('occurred_at');
      expect(l).toHaveProperty('actor_name');
      expect(l).toHaveProperty('serial_number');
    }

    for (const s of json.stationEvents ?? []) {
      expect(s).toHaveProperty('created_at');
      expect(s).toHaveProperty('actor_name');
    }
  });

  test('GET /api/orders/[id]/timeline 404s an unknown/foreign order id (org scope)', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    // A wildly-high id can't belong to the test org → ownership pre-flight 404s
    // (not 403/500), so a guessed id can never surface another tenant's trail.
    const res = await request.get('/api/orders/999999999/timeline');
    expect(res.status()).toBe(404);
  });
});
