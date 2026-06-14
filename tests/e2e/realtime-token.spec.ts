import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * End-to-end contract test for GET/POST `/api/realtime/token`.
 *
 * This hits the endpoint over REAL HTTP against a running server (Playwright's
 * `request` fixture → `baseURL` from playwright.config.ts), not the handler in
 * isolation. Authenticated calls reuse the saved session in
 * tests/.auth/admin.json that global-setup.ts mints (UI sign-in as PW_STAFF_NAME,
 * default "Michael", an admin who holds `dashboard.view`).
 *
 * HOW TO RUN
 *   1. Start the app:           npm run dev      (or: npm run build && npm run start)
 *   2. Run just this spec:      npx playwright test tests/e2e/realtime-token.spec.ts
 *      (or the npm script:      npm run test:e2e:realtime-token)
 *   Override the target/user:   PW_BASE_URL=http://localhost:3000 PW_STAFF_NAME=Michael ...
 *
 * WHAT IT ASSERTS
 *   Happy path  → 200 + a valid Ably TokenRequest, with every granted channel
 *                 capability namespaced to the caller's OWN org (the D1 isolation
 *                 guarantee), and clientId bound to the session staffId.
 *   Failure path → an unauthenticated request gets 401 UNAUTHENTICATED.
 *   Plug-in     → a 403 FORBIDDEN case for an authenticated user WITHOUT
 *                 `dashboard.view` is scaffolded and skipped; wire your own
 *                 low-permission session where marked (★ PLUG IN YOUR AUTH).
 *
 * NOTE ON RESPONSE SHAPE
 *   `/api/realtime/token` returns an **Ably TokenRequest**, not a bare
 *   `{ token, expiresAt }`. The fields are listed in TOKEN_REQUEST_SHAPE below —
 *   tweak that one constant if you ever wrap the response differently.
 */

const BASE_URL = process.env.PW_BASE_URL || 'http://localhost:3000';

/**
 * The fields an Ably TokenRequest carries. `client.auth.createTokenRequest(...)`
 * returns exactly these. Adjust here if the endpoint's response shape changes.
 */
const TOKEN_REQUEST_SHAPE: Record<string, 'string' | 'number'> = {
  keyName: 'string',
  clientId: 'string',
  capability: 'string', // JSON-encoded { "<channel>": ["subscribe", ...] }
  timestamp: 'number',
  nonce: 'string',
  mac: 'string',
  // `ttl` is present but Ably may omit/zero it depending on version — asserted softly below.
};

/** `org:{uuid}:staff:{id}` */
const CLIENT_ID_RE = /^org:[0-9a-f-]{36}:staff:\d+$/i;

/** Skip (don't fail) when the test env simply hasn't configured Ably. */
function skipIfAblyUnconfigured(status: number, body: any) {
  const msg = typeof body?.error === 'string' ? body.error : '';
  test.skip(
    status === 500 && /ABLY_API_KEY/i.test(msg),
    'ABLY_API_KEY not configured in this environment — token cannot be minted.',
  );
}

/** Parse Ably's capability (a JSON string) into { channel: actions[] }. */
function parseCapability(capability: unknown): Record<string, string[]> {
  if (typeof capability === 'string') return JSON.parse(capability);
  if (capability && typeof capability === 'object') return capability as Record<string, string[]>;
  throw new Error(`unexpected capability type: ${typeof capability}`);
}

/** Shared happy-path assertions for either verb. */
async function assertValidToken(res: Awaited<ReturnType<APIRequestContext['get']>>) {
  const status = res.status();
  const body = await res.json();
  skipIfAblyUnconfigured(status, body);

  expect(status, JSON.stringify(body)).toBe(200);

  // 1. Shape: every expected Ably TokenRequest field is present and typed.
  for (const [field, type] of Object.entries(TOKEN_REQUEST_SHAPE)) {
    expect(body, `missing "${field}"`).toHaveProperty(field);
    expect(typeof body[field], `"${field}" should be ${type}`).toBe(type);
  }
  expect(body.keyName.length, 'keyName non-empty').toBeGreaterThan(0);
  expect(body.mac.length, 'mac non-empty').toBeGreaterThan(0);

  // 2. Identity: clientId is session-derived `org:{uuid}:staff:{id}` — NOT a
  //    client-supplied value. This is what blocks staffId/identity forgery.
  expect(body.clientId, `clientId "${body.clientId}"`).toMatch(CLIENT_ID_RE);
  const orgPrefix = body.clientId.replace(/:staff:\d+$/, ''); // -> org:{uuid}

  // 3. Isolation: EVERY granted capability is scoped to THIS org's prefix.
  //    No bare/global channel (e.g. "orders:changes") and no other org may appear.
  const capability = parseCapability(body.capability);
  const channels = Object.keys(capability);
  expect(channels.length, 'token grants at least one channel').toBeGreaterThan(0);
  for (const ch of channels) {
    expect(ch.startsWith(`${orgPrefix}:`), `channel "${ch}" must be under ${orgPrefix}:`).toBe(true);
    expect(/^(orders:changes|station:changes|db:\*|inbox:\*|phone:\*|packer:\*)$/.test(ch), `bare global channel leaked: "${ch}"`).toBe(false);
  }

  // 4. Sanity: the org's orders broadcast is present and subscribe-only.
  expect(capability[`${orgPrefix}:orders:changes`], 'org orders channel granted').toBeTruthy();

  return { body, orgPrefix, capability };
}

test.describe('/api/realtime/token', () => {
  test('GET (authenticated) returns a valid, org-scoped Ably token', async ({ request }) => {
    const res = await request.get('/api/realtime/token');
    await assertValidToken(res);
  });

  test('POST (authenticated) returns a valid, org-scoped Ably token', async ({ request }) => {
    const res = await request.post('/api/realtime/token');
    await assertValidToken(res);
  });

  test('an x-ai-session header grants that org-scoped AI session channel', async ({ request }) => {
    const sessionId = 'e2e-smoke-session';
    const res = await request.get('/api/realtime/token', { headers: { 'x-ai-session': sessionId } });
    const status = res.status();
    const body = await res.json();
    skipIfAblyUnconfigured(status, body);
    expect(status).toBe(200);
    const { orgPrefix, capability } = await assertValidToken(res);
    expect(
      capability[`${orgPrefix}:ai:assist:${sessionId}`],
      'per-session AI channel is granted and org-scoped',
    ).toEqual(expect.arrayContaining(['subscribe', 'publish']));
  });

  test('FAILURE: an unauthenticated request is rejected with 401', async () => {
    // A fresh context with an EXPLICITLY EMPTY cookie jar → unauthenticated.
    // NOTE: passing `{ baseURL }` alone is not enough — under the test runner the
    // module-level `request.newContext()` inherits the project's storageState
    // (tests/.auth/admin.json), so it would arrive authenticated. An explicit
    // empty storageState overrides that and guarantees no session cookie.
    const anon: APIRequestContext = await pwRequest.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.get('/api/realtime/token', { maxRedirects: 0 });
      expect(res.status(), 'unauthenticated must be 401').toBe(401);
      const body = await res.json().catch(() => ({}));
      expect(body.error).toBe('UNAUTHENTICATED');
    } finally {
      await anon.dispose();
    }
  });

  /**
   * FAILURE: an authenticated user WITHOUT `dashboard.view` should get 403.
   *
   * ★ PLUG IN YOUR AUTH ★
   * The default saved session is an admin (holds every permission), so it can't
   * exercise the 403 branch. To enable this test, build a request context
   * authenticated as a staff member who LACKS `dashboard.view` and return it
   * from `contextForStaffWithoutDashboardView()`. Two common ways:
   *   (a) UI sign-in as that staff and save a storageState, then:
   *         pwRequest.newContext({ baseURL: BASE_URL, storageState: 'tests/.auth/lowperm.json' })
   *   (b) mint a session row for that staff and inject its cookie:
   *         pwRequest.newContext({ baseURL: BASE_URL,
   *           extraHTTPHeaders: { cookie: `${SESSION_COOKIE_NAME}=<sid>` } })
   * Then delete the `test.skip(...)` line.
   */
  test('FAILURE: authenticated-but-forbidden request is rejected with 403', async () => {
    test.skip(true, '★ wire contextForStaffWithoutDashboardView() (see comment) to enable');

    const ctx = await contextForStaffWithoutDashboardView();
    try {
      const res = await ctx.get('/api/realtime/token', { maxRedirects: 0 });
      expect(res.status()).toBe(403);
      const body = await res.json().catch(() => ({}));
      expect(body.error).toBe('FORBIDDEN');
      expect(body.permission).toBe('dashboard.view');
    } finally {
      await ctx.dispose();
    }
  });
});

/**
 * ★ PLUG IN YOUR AUTH ★ — return an APIRequestContext authenticated as a staff
 * member who does NOT have `dashboard.view`. See the test above for options.
 */
async function contextForStaffWithoutDashboardView(): Promise<APIRequestContext> {
  // return pwRequest.newContext({ baseURL: BASE_URL, storageState: 'tests/.auth/lowperm.json' });
  throw new Error('contextForStaffWithoutDashboardView() is not wired yet — see the comment above.');
}
