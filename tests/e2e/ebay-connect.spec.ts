import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * End-to-end contract + UI tests for the eBay seller-account connect flow
 * (Settings → Integrations). Hits a REAL running server over HTTP; authenticated
 * calls reuse the saved admin session from tests/.auth/admin.json (global-setup).
 *
 * HOW TO RUN
 *   1. Start the app:        npm run dev   (or: npm run build && npm run start)
 *   2. Run this spec:        npx playwright test tests/e2e/ebay-connect.spec.ts
 *      (or the npm script:   npm run test:e2e:ebay)
 *
 * The full eBay token exchange is NOT mocked — those calls happen server-side in
 * the API route, which the browser cannot intercept. Instead we assert the parts
 * we own end to end: the connect route mints an encrypted, cookie-bound state and
 * redirects to eBay with the right params; the callback's NON-eBay branches
 * (declined consent, missing params, bad state) redirect with the exact codes the
 * ResultBanner renders; the accounts/health/disconnect routes are auth-gated and
 * org-scoped; and the Settings UI shows the banners + the eBay card.
 */

const BASE_URL = process.env.PW_BASE_URL || 'http://localhost:3000';
const REDIRECT = [301, 302, 303, 307, 308];

function locationOf(res: { headers: () => Record<string, string> }): string {
  return res.headers()['location'] || '';
}

test.describe('eBay connect — API contract', () => {
  test('GET /api/ebay/connect mints cookie-bound state and 3xx-redirects to eBay', async ({ request }) => {
    const res = await request.get('/api/ebay/connect?accountName=e2e-smoke', { maxRedirects: 0 });
    expect(REDIRECT, `status ${res.status()}`).toContain(res.status());

    const location = locationOf(res);
    expect(location, 'redirects to eBay authorize').toContain('ebay.com/oauth2/authorize');
    expect(location).toContain('response_type=code');
    expect(location).toContain('state=');
    expect(location).toContain('prompt=login');
    // scope is present and URL-encoded (the SoT scope set)
    expect(location).toMatch(/scope=[^&]*api_scope/);

    // The single-use CSRF nonce is set as an httpOnly cookie.
    const setCookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const stateCookie = setCookies.find((h) => h.value.includes('ebay_oauth_state='));
    expect(stateCookie, 'ebay_oauth_state cookie is set').toBeTruthy();
    expect(stateCookie!.value.toLowerCase(), 'cookie is httpOnly').toContain('httponly');
  });

  test('GET /api/ebay/connect without accountName is 400', async ({ request }) => {
    const res = await request.get('/api/ebay/connect', { maxRedirects: 0 });
    expect(res.status()).toBe(400);
  });

  test('GET /api/ebay/callback?error=access_denied → declined-consent redirect', async ({ request }) => {
    const res = await request.get('/api/ebay/callback?error=access_denied&error_description=user_denied', { maxRedirects: 0 });
    expect(REDIRECT).toContain(res.status());
    expect(locationOf(res)).toContain('/settings/integrations?error=ebay_consent_declined');
  });

  test('GET /api/ebay/callback with no code/state → missing-params redirect', async ({ request }) => {
    const res = await request.get('/api/ebay/callback', { maxRedirects: 0 });
    expect(REDIRECT).toContain(res.status());
    expect(locationOf(res)).toContain('/settings/integrations?error=ebay_missing_oauth_params');
  });

  test('GET /api/ebay/callback with undecryptable state → invalid-state redirect', async ({ request }) => {
    const res = await request.get('/api/ebay/callback?code=abc&state=not-a-valid-envelope', { maxRedirects: 0 });
    expect(REDIRECT).toContain(res.status());
    expect(locationOf(res)).toContain('/settings/integrations?error=ebay_invalid_oauth_state');
  });

  test('GET /api/ebay/accounts is authed and returns the org account list shape', async ({ request }) => {
    const res = await request.get('/api/ebay/accounts');
    expect(res.ok(), `status ${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.accounts)).toBe(true);
  });

  test('GET /api/ebay/health returns the {ok, connected, accounts} shape', async ({ request }) => {
    const res = await request.get('/api/ebay/health');
    expect(res.ok(), `status ${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(typeof body.ok).toBe('boolean');
    expect(typeof body.connected).toBe('boolean');
    expect(Array.isArray(body.accounts)).toBe(true);
  });

  test('DELETE /api/ebay/accounts?id=<absent> is 404 (admin bypasses step-up), org-scoped', async ({ request }) => {
    const res = await request.delete('/api/ebay/accounts?id=2000000000', { maxRedirects: 0 });
    expect(res.status(), 'non-existent id → 404, not 403 step-up for admin').toBe(404);
    const body = await res.json().catch(() => ({}));
    expect(body.ok).toBe(false);
  });

  test('FAILURE: unauthenticated /api/ebay/accounts is 401', async () => {
    const anon: APIRequestContext = await pwRequest.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.get('/api/ebay/accounts', { maxRedirects: 0 });
      expect(res.status()).toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body.error).toBe('UNAUTHENTICATED');
    } finally {
      await anon.dispose();
    }
  });
});

test.describe('eBay connect — Settings UI', () => {
  test('the eBay card renders on Settings → Integrations', async ({ page }) => {
    await page.goto('/settings/integrations');
    await expect(page.getByText('Storefront orders + tracking reconciliation.').first()).toBeVisible();
  });

  test('?success=ebay_connected shows the success banner', async ({ page }) => {
    await page.goto('/settings/integrations?success=ebay_connected');
    await expect(page.getByText('eBay connected.').first()).toBeVisible();
  });

  test('?error=ebay_oauth_state_expired shows the error banner', async ({ page }) => {
    await page.goto('/settings/integrations?error=ebay_oauth_state_expired');
    await expect(page.getByText('The eBay connection link expired — please retry.').first()).toBeVisible();
  });
});
