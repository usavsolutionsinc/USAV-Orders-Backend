import { test, expect, type Page } from '@playwright/test';

/**
 * Perf guard for the shipped table's date filter.
 *
 * 1. The pill must actually re-range the table (the History-API URL write).
 * 2. A warmed range switch is an INSTANT cache read — no new `/api/packerlogs`
 *    DB query — and the update lands fast (no RSC round-trip).
 */

const PACKERLOGS = '/api/packerlogs';

async function pickPreset(page: Page, name: RegExp) {
  await page.getByTestId('date-range-pill').first().click();
  const btn = page.getByRole('button', { name }).first();
  await expect(btn).toBeVisible({ timeout: 5_000 });
  await btn.click();
}

test('shipped date pill re-ranges instantly and reads warmed weeks from cache', async ({ page }) => {
  test.setTimeout(120_000);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(PACKERLOGS)) calls.push(new URL(r.url()).search);
  });

  await page.goto('/dashboard?shipped=&layout=all');
  const pill = page.getByTestId('date-range-pill').first();
  await expect(pill).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/All shipped/i).first()).toBeVisible(); // really on Shipped

  // Let the idle warm-up prefetch the recent weeks.
  await page.waitForTimeout(4_000);
  const label0 = (await pill.innerText()).trim().replace(/\s+/g, ' ');

  // 1) Re-range to "Last week" — the label must change, and quickly.
  const t0 = Date.now();
  await pickPreset(page, /^Last week$/i);
  await expect
    .poll(async () => (await pill.innerText()).trim().replace(/\s+/g, ' '), { timeout: 8_000 })
    .not.toBe(label0);
  const reRangeMs = Date.now() - t0;
  const label1 = (await pill.innerText()).trim().replace(/\s+/g, ' ');
  const warmCount = calls.length;

  // 2) Switch to "This month" then BACK to "Last week" — the re-visit is a
  //    cached range and must add ZERO new DB calls.
  await pickPreset(page, /^This month$/i);
  await expect
    .poll(async () => (await pill.innerText()).trim().replace(/\s+/g, ' '), { timeout: 8_000 })
    .not.toBe(label1);
  const afterMonth = calls.length;

  const beforeRevisit = calls.length;
  const t1 = Date.now();
  await pickPreset(page, /^Last week$/i);
  await expect
    .poll(async () => (await pill.innerText()).trim().replace(/\s+/g, ' '), { timeout: 8_000 })
    .toBe(label1);
  const revisitMs = Date.now() - t1;
  const afterRevisit = calls.length;

  console.log(
    `[perf] reRange "${label0}"->"${label1}" ${reRangeMs}ms | warmCount=${warmCount} ` +
      `monthNewCalls=${afterMonth - warmCount} revisitNewCalls=${afterRevisit - beforeRevisit} revisit=${revisitMs}ms`,
  );

  // Re-ranging works (label changed) and the re-visited range is a pure cache
  // read (no new DB query) that lands fast.
  expect(label1).not.toBe(label0);
  expect(afterRevisit - beforeRevisit).toBe(0);
  expect(revisitMs).toBeLessThan(3_000);
});
