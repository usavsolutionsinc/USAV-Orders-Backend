import { test, expect } from '@playwright/test';

/**
 * PO mailbox email-fetch contract.
 *
 * Diagnoses + guards the "email fetch not working" failure mode: the dedicated
 * Gmail account's OAuth refresh token gets revoked/rotated (Google rotates
 * test-mode tokens ~weekly), after which every scan fails. Before the fix that
 * surfaced as an opaque 500; now the reconcile endpoint returns a 409 with
 * `needs_reconnect: true` so the UI can prompt a reconnect instead of "retry".
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) created by
 * global-setup, so request.* calls are authenticated as the admin staff (the
 * reconcile + status routes require admin.view).
 *
 * The spec branches on the live connection state so it's green whether the
 * mailbox is currently connected (→ 200 + scan shape) or revoked (→ 409 +
 * reconnect flag) — and the failure branch is the regression guard.
 */
test.describe('PO mailbox email fetch', () => {
  test('status endpoint exposes the connection + reconnect state', async ({ request }) => {
    const res = await request.get('/api/admin/po-gmail/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('connected');
    expect(body).toHaveProperty('needsReconnect');
    // When a reconnect is needed, the reason must be carried through for the UI.
    if (body.needsReconnect) {
      expect(body.needsReconnectReason, 'reconnect reason should explain why').toBeTruthy();
      // eslint-disable-next-line no-console
      console.log('PO mailbox needs reconnect:', body.accountEmail, '—', body.needsReconnectReason);
    }
  });

  test('reconcile either scans (200) or asks for reconnect (409), never an opaque 500', async ({ request }) => {
    const statusRes = await request.get('/api/admin/po-gmail/status');
    const status = await statusRes.json();

    // persist=false so the contract check never mutates the worklist / signals.
    const res = await request.get('/api/admin/po-gmail/reconcile?limit=5&persist=false');

    // The whole point: a revoked token must NOT be a 500.
    expect(res.status(), 'reconcile should never 500 on a token problem').not.toBe(500);

    if (!status.connected || status.needsReconnect) {
      // Broken-token path — the failure we were asked to diagnose.
      expect(res.status(), 'revoked/disconnected token → 409').toBe(409);
      const body = await res.json();
      expect(body.needs_reconnect).toBe(true);
      expect(String(body.error)).toMatch(/reconnect|connect/i);
    } else {
      // Healthy path — a real scan returns the reconcile shape.
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('counts');
      expect(Array.isArray(body.items)).toBe(true);
    }
  });
});
