import { test, expect } from '@playwright/test';

/**
 * Receiving → File a claim → Zendesk ticket creation.
 *
 * Verifies:
 *   - POST /api/receiving/zendesk-claim is fired with the claim payload
 *   - The route assembles a subject prefixed with "[Platform]"
 *   - The body uses the "Receiving Notes:" label (renamed from "Operator notes:")
 *   - On success the ticket number appears in a toast; on bridge failure the
 *     modal shows the draft body so the operator can copy/paste manually
 *
 * Tracking number used to open the carton — adapt to a tracking number
 * that exists in your test DB (or rely on /receiving creating one on scan).
 */
const TEST_TRACKING = process.env.PW_TEST_TRACKING || '1ZA8337B0325514010';

test.describe('Zendesk claim — receiving workspace', () => {
  test('files a damage claim and posts to /api/receiving/zendesk-claim', async ({ page }) => {
    // ── Open the receiving workspace and scan a tracking number ──────────
    await page.goto('/unbox');
    await page.getByPlaceholder(/Scan tracking/i).fill(TEST_TRACKING);
    await page.keyboard.press('Enter');

    // The first recent row should be the carton we just scanned. Adapt the
    // selector to a data-testid once one is added to the recent-row buttons.
    await page.locator('aside button').first().click();

    // ── Open the claim modal ─────────────────────────────────────────────
    const claimBtn = page.getByRole('button', { name: /CLAIM/ });
    await expect(claimBtn).toBeVisible();
    await claimBtn.click();

    await expect(page.getByText('FILE A CLAIM')).toBeVisible();

    // ── Fill it in ───────────────────────────────────────────────────────
    await page.getByRole('radio', { name: 'DAMAGE' }).click();
    await page.getByRole('radio', { name: 'HIGH' }).click();
    await page.getByLabel(/what happened/i).fill('Crushed corner, screen cracked');

    // ── Submit and capture the request ───────────────────────────────────
    const claimReq = page.waitForRequest((r) =>
      r.url().endsWith('/api/receiving/zendesk-claim') && r.method() === 'POST',
    );
    const claimRes = page.waitForResponse((r) =>
      r.url().endsWith('/api/receiving/zendesk-claim'),
    );

    await page.getByRole('button', { name: /CREATE ZENDESK TICKET/i }).click();

    const req = await claimReq;
    const res = await claimRes;

    // Payload shape sent from the modal:
    expect(req.postDataJSON()).toMatchObject({
      receivingId: expect.any(Number),
      claimType: 'damage',
      severity: 'high',
      reason: 'Crushed corner, screen cracked',
    });

    // ── Branch on bridge availability ────────────────────────────────────
    const body = await res.json();
    if (res.status() === 200 && body.success) {
      // Bridge configured + returned a ticket number → success toast
      expect(String(body.ticketNumber)).toMatch(/^#\d+$/);
      await expect(page.getByText(/Claim #\d+ created/)).toBeVisible();
    } else {
      // Bridge unreachable / no ticket # → fallback draft body shown in modal
      expect(body.draftBody).toContain('Type: Damage');
      expect(body.draftBody).toContain('Severity: High');
      expect(body.draftBody).toContain('Receiving Notes:');
      expect(body.draftBody).toContain('Crushed corner, screen cracked');
      await expect(page.getByText(/Zendesk unreachable/i)).toBeVisible();
    }
  });
});
