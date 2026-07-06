import { test, expect, type Route, type Page } from '@playwright/test';

/**
 * Receiving unbox scan-resolution ladder — desktop.
 *
 * Exercises the three-phase resolution ladder in
 * src/components/sidebar/receiving/useTrackingScan.ts:
 *
 *   Phase 0 — React Query cache instant select: if a carton with the scanned
 *             PO# or tracking# already exists in any receiving-feed cache it
 *             opens immediately with zero network calls.
 *             (This test suite keeps the cache empty via the receiving-lines
 *             mock so Phase 0 always misses and Phase 1 runs.)
 *
 *   Phase 1 — POST /api/receiving/lookup-po with { localOnly: true }
 *             Resolves against the local mirror/incoming data only; never
 *             blocks on a live Zoho call so there is NO "Opening your PO"
 *             takeover loader. On a match the PO workspace opens immediately.
 *             On a local miss (not_found + zoho_pending) the client falls
 *             through to Phase 2.
 *
 *   Phase 2 — POST /api/receiving/lookup-po without localOnly — the ONLY
 *             loader-bearing phase. The "Finding / Opening your PO" takeover
 *             renders after a 300ms grace period elapses. On a match the
 *             workspace opens. On a total miss a "No PO found" toast appears.
 *
 * All calls to /api/receiving/lookup-po and /api/receiving-lines are mocked
 * via page.route — no live Zoho API traffic. Auth state is loaded from
 * tests/.auth/admin.json (bootstrapped by global-setup.ts).
 */

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const RECEIVING_ID = 101;
const MATCHED_PO_NUMBER = 'USAV12345';

/** Minimal matched lookup-po response (server shape from /api/receiving/lookup-po). */
const matchedLookupPoPayload = {
  success: true,
  matched: true,
  po_matched: true,
  receiving_id: RECEIVING_ID,
  po_ids: ['PO-9001'],
  lines: [
    {
      id: 201,
      receiving_id: RECEIVING_ID,
      sku: 'TEST-SKU-001',
      item_name: 'Test Product',
      quantity_expected: 1,
      quantity_received: 0,
    },
  ],
  receiving_package: null,
};

/**
 * Minimal valid ReceivingLineRow returned by
 * GET /api/receiving-lines?receiving_id=RECEIVING_ID&include=serials
 * after openMatchedCarton fires the workspace hydration fetch.
 * Required fields from ReceivingLineRow (src/components/station/receiving-line-row.ts)
 * are filled; optional fields that are not needed for the workspace to mount are null.
 */
const matchedReceivingLine = {
  id: 201,
  receiving_id: RECEIVING_ID,
  tracking_number: null,
  carrier: null,
  zoho_item_id: 'ZI-001',
  zoho_line_item_id: 'ZLI-001',
  zoho_purchase_receive_id: null,
  zoho_purchaseorder_id: 'PO-9001',
  zoho_purchaseorder_number: MATCHED_PO_NUMBER,
  item_name: 'Test Product',
  sku: 'TEST-SKU-001',
  quantity_received: 0,
  quantity_expected: 1,
  qa_status: 'PENDING',
  workflow_status: null,
  disposition_code: 'PENDING',
  condition_grade: 'A',
  disposition_audit: [],
  needs_test: false,
  assigned_tech_id: null,
  zoho_sync_source: null,
  zoho_last_modified_time: null,
  zoho_synced_at: null,
  receiving_type: null,
  notes: null,
  image_url: null,
  source_platform: null,
  created_at: new Date().toISOString(),
  receiving_source: 'zoho_po',
  serials: [],
};

/** Phase 1 local miss — returned when localOnly=true and the PO is not in the mirror yet. */
const localMissPayload = {
  success: true,
  matched: false,
  not_found: true,
  zoho_pending: true,
  po_ids: [],
};

/** Total miss — returned by the full Zoho lookup when no PO is found at all. */
const totalMissPayload = {
  success: true,
  matched: false,
  not_found: true,
  po_ids: [],
  error: `No PO found for "${MATCHED_PO_NUMBER}"`,
};

/**
 * Mock /api/receiving-lines for all calls:
 *   - Workspace hydration (receiving_id=RECEIVING_ID + include=serials) → matched row
 *   - Everything else (serial probes, fetchLinesByTracking, rail data on page load) → empty
 *
 * Registered BEFORE page.goto so the initial page-load rail fetches populate an
 * empty React Query cache, preventing a spurious Phase 0 cache hit on USAV12345.
 */
async function routeReceivingLines(page: Page): Promise<void> {
  await page.route('**/api/receiving-lines**', async (route: Route) => {
    const url = route.request().url();
    const isWorkspaceHydration =
      url.includes(`receiving_id=${RECEIVING_ID}`) && url.includes('include=serials');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        isWorkspaceHydration
          ? { success: true, receiving_lines: [matchedReceivingLine] }
          : { success: true, receiving_lines: [] },
      ),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Receiving unbox scan-resolution ladder', () => {
  test(
    'recent-cache hit (Phase 0) opens the workspace with no lookup-po request',
    async ({ page }) => {
      // Phase 0: when a carton carrying the scanned PO# already lives in any
      // ['receiving-lines-table'] feed cache, the scan resolves it synchronously
      // (findCachedCartonRow in useTrackingScan.ts) and opens the workspace with
      // ZERO /api/receiving/lookup-po traffic. We seed the cache by returning the
      // matched row from EVERY receiving-lines feed (the rails populate the
      // table cache on mount), settle the initial loads via networkidle, then
      // assert the resolver endpoint is never hit.
      let lookupPoCalled = false;
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        // A Phase 0 hit must never reach here. Flag it (and still fulfill, so a
        // regression surfaces as a clean assertion failure rather than a hang).
        lookupPoCalled = true;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(matchedLookupPoPayload),
        });
      });
      // Unlike routeReceivingLines (which keeps the cache empty so Phase 1 runs),
      // here every feed returns the matched row so Phase 0 has something to find.
      await page.route('**/api/receiving-lines**', async (route: Route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: true, receiving_lines: [matchedReceivingLine] }),
        });
      });

      // networkidle = the initial rail fetches have resolved and React Query has
      // committed them to the ['receiving-lines-table'] cache that Phase 0 scans.
      await page.goto('/unbox', { waitUntil: 'networkidle' });

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(MATCHED_PO_NUMBER);
      await scanInput.press('Enter');

      const workspace = page.getByTestId('receiving-workspace');
      await expect(workspace).toBeVisible({ timeout: 10_000 });
      await expect(workspace).toHaveAttribute('data-receiving-source', 'zoho_po');

      // The carton resolved entirely from cache — the resolver was never called.
      expect(lookupPoCalled).toBe(false);
    },
  );

  test(
    'REGRESSION — dashless PO# resolves to the PO workspace, not Unfound',
    async ({ page }) => {
      // This test guards the core bug: before the fix, a dashless value like
      // "USAV12345" was heuristically treated as a tracking# (no dash) and
      // ended up in the Unfound list. With mode:"auto" the server now resolves
      // the value as either a PO# or a tracking# — a found PO must always open
      // the zoho_po workspace.
      await routeReceivingLines(page);
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(matchedLookupPoPayload),
        });
      });

      await page.goto('/unbox');

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(MATCHED_PO_NUMBER);
      await scanInput.press('Enter');

      const workspace = page.getByTestId('receiving-workspace');
      await expect(workspace).toBeVisible({ timeout: 10_000 });
      await expect(workspace).toHaveAttribute('data-receiving-source', 'zoho_po');
    },
  );

  test(
    'local/mirror hit (Phase 1) opens the workspace without the "Opening your PO" loader',
    async ({ page }) => {
      // When the localOnly Phase 1 call returns a match, showZohoLoader() is
      // never called (it only fires on not_found+zoho_pending). The workspace
      // must open and the "Finding / Opening your PO" skeleton must remain absent.
      await routeReceivingLines(page);
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(matchedLookupPoPayload),
        });
      });

      await page.goto('/unbox');

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(MATCHED_PO_NUMBER);
      await scanInput.press('Enter');

      const workspace = page.getByTestId('receiving-workspace');
      await expect(workspace).toBeVisible({ timeout: 10_000 });
      await expect(workspace).toHaveAttribute('data-receiving-source', 'zoho_po');

      // The loader is guarded by a 300ms grace delay in useReceivingWorkspacePane.
      // A fast local resolve cancels the show timer so the loader never mounts.
      await expect(page.getByText(/Finding your PO|Opening your PO/i)).toHaveCount(0);
    },
  );

  test(
    'Zoho fallback (Phase 2): localOnly miss triggers loader, then matched workspace opens',
    async ({ page }) => {
      // Phase 1 (localOnly) misses; showZohoLoader() fires after the 300ms grace
      // delay. Phase 2 (full Zoho lookup) resolves after an artificial 500ms delay
      // so the grace period is exceeded and the loader actually renders. After
      // Phase 2 succeeds the workspace opens with source zoho_po.
      await routeReceivingLines(page);
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (body?.localOnly === true) {
          // Phase 1 — instant local miss
          await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(localMissPayload),
          });
        } else {
          // Phase 2 — delayed to outlive the 300ms grace so the loader renders
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          await route.fulfill({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(matchedLookupPoPayload),
          });
        }
      });

      await page.goto('/unbox');

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(MATCHED_PO_NUMBER);
      await scanInput.press('Enter');

      // Phase 2 loader must render while the Zoho call is in flight
      await expect(page.getByText(/Finding your PO|Opening your PO/i)).toBeVisible({
        timeout: 10_000,
      });

      // After Phase 2 resolves, workspace opens with the matched PO
      const workspace = page.getByTestId('receiving-workspace');
      await expect(workspace).toBeVisible({ timeout: 10_000 });
      await expect(workspace).toHaveAttribute('data-receiving-source', 'zoho_po');
    },
  );

  test(
    'total miss shows "No PO found" toast and does not open an unmatched workspace',
    async ({ page }) => {
      // Both Phase 1 (localOnly miss) and Phase 2 (Zoho miss) return not_found.
      // The client shows a toast and returns early — no unfound carton workspace
      // is created and setSelectedLine is never called.
      await routeReceivingLines(page);
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body?.localOnly === true ? localMissPayload : totalMissPayload),
        });
      });

      await page.goto('/unbox');

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(MATCHED_PO_NUMBER);
      await scanInput.press('Enter');

      await expect(page.getByText(/No PO found/i)).toBeVisible({ timeout: 10_000 });

      // No unmatched workspace must be present — the early return prevents one from mounting
      await expect(
        page.locator('[data-testid="receiving-workspace"][data-receiving-source="unmatched"]'),
      ).toHaveCount(0);
    },
  );

  test(
    'REGRESSION — opening an unfound carton never shows a "Package not found" toast',
    async ({ page }) => {
      // BUG: the unmatched-items auto-loader (useUnmatchedItems.refreshLines) GETs
      // /api/receiving/:id on carton open and used to toast the raw body.error.
      // When that GET 404s — an optimistic open, a mid-create race, or a stale
      // unfound-queue stub — the operator saw "Package not found". It must now
      // degrade silently to an empty card while the workspace still opens.
      const UNFOUND_ID = 202;
      // Dashless so the unbox bar treats it as a tracking# (a dashed value
      // auto-arms Order# mode, which would route a miss to the "No PO found"
      // toast instead of creating an unfound carton).
      const UNFOUND_TRACKING = '1Z999AA10123456784';

      await routeReceivingLines(page);

      // The Received rail's unfound source — keep it empty so nothing else
      // auto-selects and competes with the scanned carton.
      await page.route('**/api/receiving/unfound-queue**', (route: Route) =>
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows: [] }),
        }),
      );

      // Phase 1 localOnly creates the unfound carton and returns it as unmatched
      // (a tracking miss does not escalate to Phase 2 / not_found).
      await page.route('**/api/receiving/lookup-po', async (route: Route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            success: true,
            matched: false,
            receiving_id: UNFOUND_ID,
            po_ids: [],
          }),
        });
      });

      // touch-scan is fire-and-forget — stub it so it never errors the console.
      await page.route('**/api/receiving/touch-scan', (route: Route) =>
        route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }),
      );

      // The carton-context GET 404s — the exact race that used to toast. Flag it
      // so the test proves the auto-loader actually ran (not a trivial pass).
      let cartonGetCalled = false;
      await page.route(`**/api/receiving/${UNFOUND_ID}`, async (route: Route) => {
        cartonGetCalled = true;
        await route.fulfill({
          status: 404,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Package not found' }),
        });
      });

      await page.goto('/unbox');

      const scanInput = page.getByPlaceholder(/Tracking, PO/i);
      await scanInput.fill(UNFOUND_TRACKING);
      await scanInput.press('Enter');

      // The unmatched workspace still opens optimistically from the stub.
      const workspace = page.locator(
        '[data-testid="receiving-workspace"][data-receiving-source="unmatched"]',
      );
      await expect(workspace).toBeVisible({ timeout: 10_000 });

      // The auto-loader fired against the 404 (we genuinely exercised the path)…
      await expect.poll(() => cartonGetCalled, { timeout: 10_000 }).toBe(true);

      // …and the operator NEVER sees a raw "Package not found" / "Failed to load
      // lines" toast from the degraded auto-load.
      await expect(page.getByText(/Package not found/i)).toHaveCount(0);
      await expect(page.getByText(/Failed to load lines/i)).toHaveCount(0);
    },
  );
});
