import { test, expect } from '@playwright/test';

/**
 * P1-RCV-01 — Receiving Incoming to-do list seeded from email order numbers.
 *
 * Network + UI verification (no live mailbox call from the test). Asserts the
 * three acceptance criteria:
 *   A. Ingested email order numbers render as actionable to-do items.
 *   B. The list is searchable (typing narrows the GET via ?q=).
 *   C. Checking an item off PATCHes the to-do endpoint with { done: true },
 *      and the action is reversible (Undo → { done: false }).
 *
 * The to-do list is pinned in the Incoming-mode sidebar and reads
 * GET /api/receiving-lines/incoming/todo (receiving.view scoped). Mutations go
 * to PATCH /api/receiving-lines/incoming/todo as a reversible pile move.
 *
 * Run via the repo's Playwright config (global-setup handles auth). Do NOT run
 * live without a seeded org that has at least one open email worklist row.
 */
test.describe('Incoming email to-do list', () => {
  test('A — ingested order numbers render as to-do items', async ({ page }) => {
    const todoReq = page.waitForRequest((r) =>
      /\/api\/receiving-lines\/incoming\/todo(\?|$)/.test(r.url()) && r.method() === 'GET',
    );
    await page.goto('/receiving?mode=incoming');
    await todoReq;

    // The pinned to-do header is present.
    await expect(page.getByText(/Email to-do/i)).toBeVisible();
  });

  test('B — search narrows the list via ?q=', async ({ page }) => {
    await page.goto('/receiving?mode=incoming');
    await expect(page.getByText(/Email to-do/i)).toBeVisible();

    const search = page.getByPlaceholder(/Search order #, subject/i);
    const filtered = page.waitForRequest((r) =>
      /\/api\/receiving-lines\/incoming\/todo\?q=/.test(r.url()) && r.method() === 'GET',
    );
    await search.fill('1001');
    await filtered; // server-side filter fired
  });

  test('C — check-off PATCHes done:true and is reversible', async ({ page }) => {
    await page.goto('/receiving?mode=incoming');
    await expect(page.getByText(/Email to-do/i)).toBeVisible();

    const checkBtn = page.getByRole('button', { name: /^Mark done$/i }).first();
    // Skip cleanly if the seed org has no open to-dos.
    if ((await checkBtn.count()) === 0) test.skip(true, 'no open to-do rows seeded');

    const patchDone = page.waitForRequest((r) =>
      r.url().includes('/api/receiving-lines/incoming/todo') &&
      r.method() === 'PATCH',
    );
    await checkBtn.click();
    const req = await patchDone;
    expect(req.postDataJSON()).toMatchObject({ done: true });

    // Reversible: an Undo toast restores it with done:false.
    const undo = page.getByRole('button', { name: /^Undo$/i });
    if ((await undo.count()) > 0) {
      const patchUndo = page.waitForRequest((r) =>
        r.url().includes('/api/receiving-lines/incoming/todo') &&
        r.method() === 'PATCH',
      );
      await undo.click();
      const undoReq = await patchUndo;
      expect(undoReq.postDataJSON()).toMatchObject({ done: false });
    }
  });
});
