import { test, expect } from '@playwright/test';

/**
 * Operations ▸ History unified header search (deliverable #2 of
 * docs/global-header-search-best-in-class-plan.md, Phase D).
 *
 * With NEXT_PUBLIC_UNIFIED_HEADER_SEARCH on, /operations?mode=history is a
 * two-region browse→drill surface driven by the GLOBAL header (no sidebar
 * search bar): type a fuzzy term → orders-first result rows; click/deep-link a
 * record → its journey timeline; Clear → back to the list.
 *
 * Data-independent smoke: it asserts the STRUCTURE that always renders
 * (orders-first tab rail, focused-vs-browse region, contextual header placeholder,
 * URL hydration) rather than specific hits, so it passes on any seeded tenant
 * and never depends on AI-search embeddings being present. Desktop only — this
 * is the desktop Workbench/Monitor surface (mobile scan is a separate archetype).
 */

test.describe('Operations history — unified header search', () => {
  test.skip(({ browserName }) => false, 'runs on the desktop project');

  test('?q= hydrates the orders-first results region', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop operations surface');

    // Deep-link a browse query (a term unlikely to match many records — the tab
    // rail renders regardless of hits, so this is deterministic).
    await page.goto('/operations?mode=history&q=zzqotest');

    // The shared results surface's orders-first tab rail is present
    // (HorizontalButtonSlider renders role="tab" pills with an aria-label).
    const ordersTab = page.getByRole('tab', { name: 'Orders', exact: true }).first();
    const unitsTab = page.getByRole('tab', { name: 'Units', exact: true }).first();
    await expect(ordersTab).toBeVisible();
    await expect(unitsTab).toBeVisible();

    // Orders precedes Units in the DOM (the operations orders-first ordering, L2).
    const ordersBeforeUnits = await ordersTab.evaluate((orders, units) => {
      const pos = orders.compareDocumentPosition(units as Node);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }, await unitsTab.elementHandle());
    expect(ordersBeforeUnits, 'Orders tab should precede Units (orders-first)').toBeTruthy();

    // A results state renders (results line, teaching-empty, or the AI-search
    // permission notice) — never a blank pane, never the paste-a-number empty.
    await expect(
      page.getByText(
        /result|No matches|Searching|AI search|Search everything/i,
      ).first(),
    ).toBeVisible();
  });

  test('?order= deep-link hydrates the drill (timeline) region; Clear exits the drill', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop operations surface');

    // A focused entity via the URL → the record-journey region (regardless of
    // whether that id resolves to data — the focused chrome still renders).
    await page.goto('/operations?mode=history&order=999999');

    // Focused region: a record chip + a "Clear" affordance that leaves focus.
    const clear = page.getByRole('button', { name: /^Clear/i }).first();
    await expect(clear).toBeVisible();

    // Clearing drops the focused entity from the URL and leaves the drill region.
    await clear.click();
    await expect(page).not.toHaveURL(/order=999999/, { timeout: 5_000 });
    await expect(clear).toHaveCount(0);
  });

  test('the contextual header pill drives the browse ?q= (no sidebar search bar)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'Desktop operations surface');

    await page.goto('/operations?mode=history');

    // The GLOBAL header field is scoped to operations (its placeholder proves the
    // contextual registration; the sidebar no longer owns a search bar).
    const header = page.getByPlaceholder(/Search shipped orders/i);
    await expect(header).toBeVisible();

    // Typing drives ?q= (debounced) — the header is the single search input.
    await header.fill('samsung');
    await expect(page).toHaveURL(/mode=history/);
    await expect(page).toHaveURL(/q=samsung/, { timeout: 5_000 });
  });
});
