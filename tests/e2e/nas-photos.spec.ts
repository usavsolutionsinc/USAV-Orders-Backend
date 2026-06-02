import { test, expect } from '@playwright/test';

/**
 * NAS photo picker — two tests:
 *
 * 1. API contract (desktop project)
 *    Calls POST /api/receiving-photos with a `photoUrl` (NAS-style attach, no
 *    blob upload) and verifies the persisted row echoes the exact URL back.
 *    Then calls GET /api/receiving-photos?receivingId=N&scope=po and confirms
 *    the row appears in the list.
 *
 * 2. UI smoke (mobile project)
 *    Opens /m/receiving/po/[poId]/gallery, confirms the "NAS" button is visible
 *    (requires NEXT_PUBLIC_NAS_PHOTOS_BASE_URL to be set in the dev server),
 *    clicks it, verifies the NasPhotoPicker dialog opens (role=dialog,
 *    heading "Select from NAS"), and closes it cleanly.
 *
 * Environment vars used by these tests (all optional — tests are skipped or
 * branched when absent):
 *   PW_TEST_RECEIVING_ID   – integer id of a receiving row in the test DB
 *   PW_TEST_PO_ID          – PO identifier string (e.g. "PO-001") used to
 *                            construct the gallery URL
 *   PW_NAS_TEST_PHOTO_URL  – a real or mock URL to attach as a NAS photo;
 *                            defaults to a placeholder that exercises the path
 *                            but will likely 404 in a real NAS-less env
 *   NEXT_PUBLIC_NAS_PHOTOS_BASE_URL – required for the NAS button to render
 */

const RECEIVING_ID = Number(process.env.PW_TEST_RECEIVING_ID || '1');
const PO_ID = process.env.PW_TEST_PO_ID || 'TEST-PO-001';

test.describe('NAS photo picker', () => {
  // ── Test 1: API — attach-by-URL, retrieve, idempotency, cleanup ────────────
  // This exercises the exact contract the picker relies on: the existing
  // /api/receiving-photos endpoint accepting a `photoUrl` (no blob upload).
  // We use a unique URL per run so the test is deterministic regardless of DB
  // state, and we delete the row at the end so nothing is left behind.
  test('POST /api/receiving-photos with photoUrl persists, is returned by GET, is idempotent', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — run against desktop project');

    // Unique per-run NAS-style URL → always a fresh insert, never a stale 409.
    const nasUrl = `http://nas.e2e.local:8088/e2e/${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}.jpg`;

    // 1) Attach by URL (the NAS path — no blob upload).
    const postRes = await request.post('/api/receiving-photos', {
      data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
    });
    expect(postRes.ok(), `POST failed with ${postRes.status()}`).toBeTruthy();
    const body = await postRes.json();
    expect(body.success).toBe(true);
    expect(body.photo.photoUrl).toBe(nasUrl);
    expect(body.photo.receivingId).toBe(RECEIVING_ID);
    expect(body.photo.receivingLineId).toBeNull();
    const createdId: number = body.photo.id;

    try {
      // 2) GET the PO-level gallery; our URL must be present.
      const getRes = await request.get(
        `/api/receiving-photos?receivingId=${RECEIVING_ID}&scope=po`,
      );
      expect(getRes.ok()).toBeTruthy();
      const { photos } = await getRes.json();
      expect(Array.isArray(photos)).toBe(true);
      const match = (photos as Array<{ photoUrl: string }>).find((p) => p.photoUrl === nasUrl);
      expect(match, 'Attached NAS photo URL not found in GET response').toBeDefined();

      // 3) Re-attaching the same URL is a no-op (unique index → 409). This is
      //    what lets a receiver re-select the same shot without an error.
      const dupRes = await request.post('/api/receiving-photos', {
        data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
      });
      expect(dupRes.status(), 'duplicate attach should conflict').toBe(409);
    } finally {
      // 4) Clean up the row we created so the test is self-contained.
      const delRes = await request.delete(`/api/receiving-photos?id=${createdId}`);
      expect(delRes.ok(), `cleanup DELETE failed with ${delRes.status()}`).toBeTruthy();
    }
  });

  // ── Test 2: UI — NAS button opens the picker dialog ───────────────────────
  test('gallery page shows NAS button and opens picker when clicked', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only');

    const galleryUrl = `/m/receiving/po/${encodeURIComponent(PO_ID)}/gallery`;
    await page.goto(galleryUrl);

    // The page issues an API call for the PO header; wait for it to settle so
    // the conditional NAS button has a chance to render.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // networkidle can time-out on slow CI; fall through and let the assertion
      // below give the real error message.
    });

    // If the dev server has NEXT_PUBLIC_NAS_PHOTOS_BASE_URL set, the button
    // renders; otherwise we cannot test the UI path and we skip gracefully.
    const nasButton = page.getByRole('button', { name: /^NAS$/i });
    const isVisible = await nasButton.isVisible().catch(() => false);
    if (!isVisible) {
      test.skip(
        true,
        'NEXT_PUBLIC_NAS_PHOTOS_BASE_URL is not set — NAS button not rendered, skipping UI half',
      );
      return;
    }

    // Open the picker.
    await nasButton.click();

    // The NasPhotoPicker renders role=dialog with the heading text "Select from NAS".
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText(/Select from NAS/i)).toBeVisible();

    // Close it — the Close button sits in the dialog header.
    await dialog.getByRole('button', { name: /close/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  });
});
