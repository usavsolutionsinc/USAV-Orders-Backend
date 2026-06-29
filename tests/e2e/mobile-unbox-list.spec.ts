import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Mobile unbox list display guard — `/m/receiving` (and the <768px desktop
 * fallback) render {@link MobileReceivingList}, which must show the EXACT same
 * list as the desktop unbox-mode rail: the "Unboxed" sub-view of
 * /receiving?mode=receive → ReceivingRecentRail → view=activity, sort=
 * unboxed_newest, all-staff.
 *
 * Guards two regressions:
 *  - the feed silently using a different `view`/`sort` than the unbox rail, and
 *  - the feed rendering "No packages yet" when the rail has rows.
 *
 * Auth comes from the saved storageState (tests/.auth/admin.json) via
 * global-setup, so request.* / page.* run as the admin staff.
 */

const FEED_PARAMS = 'view=activity&include=serials&sort=unboxed_newest';

async function unboxRailRows(request: APIRequestContext) {
  const res = await request.get(`/api/receiving-lines?limit=500&offset=0&${FEED_PARAMS}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return (body.receiving_lines ?? body.rows ?? []) as any[];
}

test.describe('mobile unbox list mirrors the desktop unbox-mode rail', () => {
  test('API: the unbox-rail query returns rows to display', async ({ request }) => {
    const rows = await unboxRailRows(request);
    test.skip(rows.length === 0, 'no unboxed receiving lines in this environment');
    expect(rows.length).toBeGreaterThan(0);
    console.log(`[mobile-unbox] unbox-rail (view=activity, unboxed_newest) rows=${rows.length}`);
  });

  test('UI: /m/receiving requests the unbox-rail query and renders rows', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only');

    // The feed must hit the SAME view+sort as the desktop unbox rail.
    const feedReq = page.waitForResponse(
      (r) =>
        r.url().includes('/api/receiving-lines') &&
        r.url().includes('view=activity') &&
        r.url().includes('sort=unboxed_newest'),
      { timeout: 20_000 },
    );

    await page.goto('/m/receiving');

    const res = await feedReq;
    expect(res.status()).toBe(200);
    const body = await res.json();
    const rows: any[] = body.receiving_lines ?? body.rows ?? [];

    test.skip(rows.length === 0, 'no unboxed receiving lines in this environment');

    // With data present, the empty state must NOT show (MobileFeed renders the
    // empty branch only when rows===0 && !isLoading — so any stale/failed fetch
    // would surface here).
    await expect
      .poll(async () => page.getByText(/No packages yet/i).count(), { timeout: 10_000 })
      .toBe(0);
  });
});
