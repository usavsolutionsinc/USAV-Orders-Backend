import { test, expect } from '@playwright/test';

/**
 * Warranty claim ↔ Zendesk round-trip UI
 *
 * Verifies:
 *   - A warranty claim can be created via the API and opened in the
 *     Warranty Logger mode (/dashboard?warranty=&open=<id>)
 *   - Clicking the support-ticket icon button opens the "Support ticket thread"
 *     popover showing "No Zendesk ticket yet"
 *   - POST /api/warranty/claims/<id>/zendesk is intercepted and fulfilled with
 *     a mock ticket so no real Zendesk API is called
 *   - After creation the popover header updates to "Ticket #9999" and the
 *     mocked comment body appears in the thread
 *   - Typing in the composer and clicking Send fires
 *     POST /api/warranty/claims/<id>/zendesk/comments with the typed text
 *   - DELETE /api/warranty/claims/<id> (soft-delete) returns ok: true
 *
 * The test is skipped gracefully when the WARRANTY_LOGGER feature flag is off
 * (the claim-create API returns 503), mirroring how other specs guard on
 * missing env.
 */

test.describe('Warranty claim — Zendesk round-trip', () => {
  test('creates a claim, links a Zendesk ticket via mock, and posts a reply', async ({
    page,
    request,
  }) => {
    // ── 1. Setup: create a warranty claim via the API ─────────────────────
    const serial = `PW-WZ-${Date.now()}`;

    const createRes = await request.post('/api/warranty/claims', {
      data: { serialNumber: serial },
    });

    if (createRes.status() === 503) {
      test.skip(true, 'WARRANTY_LOGGER feature flag is off — skipping');
      return;
    }

    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const claimId: number | string = created.id ?? created.claim?.id;
    expect(claimId).toBeTruthy();

    // ── 2. Register route intercepts before navigation ────────────────────

    // The popover decides "linked" off the claim's zendeskTicketId; the mocked
    // ticket-create never touches the DB, so patch the real claim GET response
    // to reflect the link once the mocked POST has fired.
    let linked = false;
    await page.route(new RegExp(`/api/warranty/claims/${claimId}$`), async (route) => {
      // A background react-query refetch can still be in flight when the test
      // ends; guard route.fetch() so a lingering call during teardown doesn't
      // throw "Target page has been closed" and fail an otherwise-passing test.
      try {
        const res = await route.fetch();
        const json = await res.json().catch(() => null);
        if (linked && json?.claim) json.claim.zendeskTicketId = 9999;
        await route.fulfill({ response: res, body: JSON.stringify(json) });
      } catch {
        await route.abort().catch(() => {});
      }
    });

    // GET .../zendesk — live ticket status; POST — create ticket
    await page.route(`**/api/warranty/claims/${claimId}/zendesk`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            ticket: {
              id: 9999,
              subject: `Warranty claim: ${serial}`,
              status: 'open',
              priority: null,
              updatedAt: new Date().toISOString(),
            },
            ticketUrl: 'https://example.zendesk.com/agent/tickets/9999',
          }),
        });
      } else {
        // POST — create ticket
        linked = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            ticketId: 9999,
            ticketUrl: 'https://example.zendesk.com/agent/tickets/9999',
            claim: { id: claimId, serialNumber: serial, zendeskTicketId: 9999 },
          }),
        });
      }
    });

    // GET .../zendesk/comments
    await page.route(`**/api/warranty/claims/${claimId}/zendesk/comments`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            comments: [
              {
                id: 1,
                body: 'Warranty claim received. Serial: ' + serial,
                htmlBody: null,
                public: true,
                authorId: 1,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        });
      } else {
        // POST — add reply; fulfilled later via a captured promise
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, ticketStatus: 'open' }),
        });
      }
    });

    // ── 3. Navigate to Warranty Logger with the claim open ────────────────
    await page.goto(`/dashboard?warranty=&open=${claimId}`);

    // ── 4. Open the support-ticket popover ───────────────────────────────
    // The icon button renders both on the claim's table row and in the detail
    // panel header — either opens the same popover, so take the first.
    const ticketIconBtn = page.getByRole('button', { name: /create zendesk ticket/i }).first();
    await expect(ticketIconBtn).toBeVisible({ timeout: 15_000 });
    await ticketIconBtn.click();

    const popover = page.getByRole('dialog', { name: /support ticket thread/i });
    await expect(popover).toBeVisible();
    await expect(popover.getByText(/no zendesk ticket yet/i)).toBeVisible();

    // ── 5. Create the ticket via the mocked API ───────────────────────────
    const createTicketBtn = popover.getByRole('button', { name: /create zendesk ticket/i });
    await expect(createTicketBtn).toBeVisible();

    // Capture the outgoing POST to assert later
    const ticketPostReq = page.waitForRequest(
      (r) =>
        r.url().includes(`/api/warranty/claims/${claimId}/zendesk`) &&
        !r.url().includes('/comments') &&
        r.method() === 'POST',
    );

    await createTicketBtn.click();
    await ticketPostReq; // confirms the request fired

    // ── 6. Assert the popover updates to show the linked ticket ──────────
    await expect(popover.getByText(/ticket #9999/i)).toBeVisible({ timeout: 10_000 });

    // The mocked comment body should appear in the thread
    await expect(
      popover.getByText(new RegExp(`Warranty claim received\\. Serial: ${serial}`)),
    ).toBeVisible();

    // ── 7. Reply: type a message and click Send ───────────────────────────
    const replyText = `E2E reply from warranty-zendesk spec — claim ${claimId}`;
    const commentPostReq = page.waitForRequest(
      (r) =>
        r.url().includes(`/api/warranty/claims/${claimId}/zendesk/comments`) &&
        r.method() === 'POST',
    );

    const composer = popover.getByRole('textbox');
    await expect(composer).toBeVisible();
    await composer.fill(replyText);

    const sendBtn = popover.getByRole('button', { name: /send/i });
    await expect(sendBtn).toBeVisible();
    await sendBtn.click();

    const commentReq = await commentPostReq;
    const commentBody = commentReq.postDataJSON();
    expect(commentBody).toMatchObject({
      body: expect.stringContaining(replyText),
    });

    // ── 8. Teardown: soft-delete the claim ────────────────────────────────
    const deleteRes = await request.delete(`/api/warranty/claims/${claimId}`);
    expect(deleteRes.ok()).toBeTruthy();
    const deleteBody = await deleteRes.json();
    expect(deleteBody).toMatchObject({ ok: true });
  });
});
