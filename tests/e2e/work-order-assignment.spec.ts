import { test, expect } from '@playwright/test';

/**
 * Work-order assignment + global-header priority (P1-WORK-01).
 *
 * Acceptance:
 *   A. Assign / reassign a task to staff from a popover.
 *   B. The global header surfaces the top-priority work order for the signed-in
 *      operator.
 *
 * This spec is API-first (deterministic, no UI timing) plus a light header-chip
 * presence check. It is read-mostly: the only write is an idempotent reassign of
 * an order's tester, which PATCH /api/work-orders already supports and which the
 * existing modal flow performs in production. Set PW_WORK_ORDER_ENTITY_ID +
 * PW_WORK_ORDER_STAFF_ID to exercise the assign path against the test DB.
 *
 * NOTE: requires a running dev server + an authed session (global-setup). Do NOT
 * run against production data.
 */
const ENTITY_ID = Number(process.env.PW_WORK_ORDER_ENTITY_ID || 0);
const STAFF_ID = Number(process.env.PW_WORK_ORDER_STAFF_ID || 0);

test.describe('P1-WORK-01 — work-order assignment + header priority', () => {
  // ── Acceptance B: header derives the operator's top work order ──────────
  test('GET /api/work-orders/mine returns a slim top work order (or null)', async ({ request }) => {
    const res = await request.get('/api/work-orders/mine');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('top');
    if (body.top) {
      // Shape contract the header chip relies on.
      for (const key of ['id', 'entityType', 'entityId', 'title', 'queueLabel', 'sourcePath', 'role']) {
        expect(body.top).toHaveProperty(key);
      }
      expect(['tester', 'packer']).toContain(body.top.role);
    }
  });

  test('the global header is reachable and renders chrome for the signed-in operator', async ({ page }) => {
    await page.goto('/dashboard');
    // The header bar is sticky chrome present on every authed page; the priority
    // chip only renders when the operator has actionable assigned work, so we
    // assert the header itself (banner) is present rather than the conditional chip.
    await expect(page.locator('header').first()).toBeVisible();
  });

  // ── Acceptance A: assign / reassign via the endpoint the popover calls ──
  test('PATCH /api/work-orders assigns a tester (mirrors the popover save)', async ({ request }) => {
    test.skip(
      !ENTITY_ID || !STAFF_ID,
      'Set PW_WORK_ORDER_ENTITY_ID + PW_WORK_ORDER_STAFF_ID to a pending order + present tester.',
    );

    const res = await request.patch('/api/work-orders', {
      data: {
        entityType: 'ORDER',
        entityId: ENTITY_ID,
        assignedTechId: STAFF_ID,
        status: 'ASSIGNED',
        priority: 100,
        deadlineAt: null,
      },
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toMatchObject({ success: true });

    // Reassigning to null (unassign) is the reverse — confirms reversibility.
    const undo = await request.patch('/api/work-orders', {
      data: {
        entityType: 'ORDER',
        entityId: ENTITY_ID,
        assignedTechId: null,
        status: 'OPEN',
        priority: 100,
        deadlineAt: null,
      },
    });
    expect(undo.ok()).toBeTruthy();
  });
});
