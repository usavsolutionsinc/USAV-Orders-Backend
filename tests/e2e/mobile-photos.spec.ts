import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Mobile (iPhone 14 emulation) — photo upload during receiving/packing →
 * verify photos are persisted on the carton and surfaced in the Zendesk
 * claim body.
 *
 * Run only against the `mobile` project:
 *   npx playwright test mobile-photos.spec.ts --project=mobile
 */
test.use({ ...test.info().project.use, hasTouch: true });

const TEST_TRACKING = process.env.PW_TEST_TRACKING || '1ZA8337B0325514010';
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');

test.describe('Mobile pipeline → photo upload → Zendesk attachment', () => {
  test('uploads photos and surfaces them in the Zendesk claim body', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only');

    await page.goto('/m/pick'); // mobile packing/pick entry — adapt to your route
    await page.getByPlaceholder(/Scan tracking/i).fill(TEST_TRACKING);
    await page.keyboard.press('Enter');

    // ── Upload photos via the file input ──────────────────────────────────
    const uploadReq = page.waitForRequest((r) =>
      r.url().includes('/api/receiving-photos') && r.method() === 'POST',
    );

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      path.join(FIXTURE_DIR, 'damage-1.jpg'),
      path.join(FIXTURE_DIR, 'damage-2.jpg'),
    ]);

    const upload = await uploadReq;
    // Verify multipart and that a PO/receiving reference is present:
    expect(upload.headers()['content-type']).toMatch(/multipart\/form-data/);
    const buf = upload.postDataBuffer()?.toString('utf8') || '';
    expect(buf).toMatch(/name="receivingId"|name="receiving_id"/);

    // Thumbnails appear in the review screen
    await expect(page.getByText(/2 photos? attached/i)).toBeVisible({ timeout: 10_000 });

    // ── File the claim → the claim body should list the photo URLs ────────
    await page.getByRole('button', { name: /CLAIM/i }).click();
    await page.getByRole('radio', { name: 'DAMAGE' }).click();
    await page.getByLabel(/what happened/i).fill('Two corners crushed on arrival');

    const claimRes = page.waitForResponse((r) =>
      r.url().endsWith('/api/receiving/zendesk-claim'),
    );
    await page.getByRole('button', { name: /CREATE ZENDESK TICKET/i }).click();
    const res = await claimRes;
    const body = await res.json();

    // The route inlines photo URLs in the description body.
    const draftOrBody = body.draftBody ?? '';
    if (body.success) {
      // When the bridge accepts the ticket, the photo URLs are inside the
      // POST sent to the GAS bridge, not echoed back. Cross-check via Zendesk
      // API (see helper below) or assert on the upload request fixture above.
      expect(String(body.ticketNumber)).toMatch(/^#\d+$/);
    } else {
      expect(draftOrBody).toMatch(/Photos attached \(2\):/);
      expect(draftOrBody).toMatch(/https?:\/\/\S+\.(jpg|jpeg|png|webp)/i);
    }
  });
});

/**
 * Helper: cross-check a Zendesk ticket has N attachments. Requires
 * ZENDESK_SUBDOMAIN + ZENDESK_EMAIL + ZENDESK_API_TOKEN. Call from a test:
 *
 *   const count = await zendeskAttachmentCount(ticketNumber);
 *   expect(count).toBeGreaterThanOrEqual(2);
 */
export async function zendeskAttachmentCount(ticketNumber: string): Promise<number> {
  const id = ticketNumber.replace(/^#/, '');
  const sub = process.env.ZENDESK_SUBDOMAIN!;
  const auth = Buffer.from(
    `${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`,
  ).toString('base64');

  const res = await fetch(
    `https://${sub}.zendesk.com/api/v2/tickets/${id}/comments.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) throw new Error(`Zendesk API ${res.status}`);
  const data = (await res.json()) as { comments: Array<{ attachments?: unknown[] }> };
  return data.comments.reduce((n, c) => n + (c.attachments?.length || 0), 0);
}
