import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Receiving / Unbox photo capture → same-origin /api/nas CRUD proxy.
 *
 * Covers the production write path added in the NAS-proxy change: the browser
 * talks ONLY to the same-origin /api/nas route, which does the real read/write
 * server-side. Here the proxy's upstream is pointed at the dev NAS mount route
 * so the whole pipe runs against the REAL NAS test photos with no office tunnel:
 *
 *   npx tsx — start the dev server with:
 *     NAS_DEV_ROOT="/Volumes/USAV Media/Puchasing photos/2026" \
 *     NAS_RW_URL="http://localhost:3000/api/nas-dev" \
 *     npm run dev
 *   then: npx playwright test unbox-nas-photos.spec.ts --project=desktop
 *         npx playwright test unbox-nas-photos.spec.ts --project=mobile
 *
 * Against the real office host (nas-photos.michaelgarisek.com) reads pass; the
 * PUT/DELETE round-trip returns 502 until the office side exposes a write verb
 * (see docs/nas-receiving-write-tunnel-plan.md) — set PW_NAS_READONLY=1 to relax
 * the write asserts in that environment.
 */

// The receiving row these photos bind to (an order number resolved at runtime).
const ORDER = process.env.PW_TEST_ORDER || '63116592';
// A folder under the NAS root that holds real test photos.
const NAS_DIR = process.env.PW_NAS_TEST_DIR || 'JUN 2026';
// The local mount, used only to pick a real fixture filename + bytes to PUT.
const NAS_MOUNT = process.env.NAS_DEV_ROOT || '/Volumes/USAV Media/Puchasing photos/2026';
const READONLY = process.env.PW_NAS_READONLY === '1';

const apiPath = (rel: string) =>
  `/api/nas/${rel.split('/').map(encodeURIComponent).join('/')}`;

/** Resolve order number → receiving package id via the receiving feed search. */
async function resolveReceivingId(
  request: import('@playwright/test').APIRequestContext,
): Promise<number> {
  const res = await request.get(
    `/api/receiving-lines?search=${encodeURIComponent(ORDER)}&limit=1`,
  );
  expect(res.ok(), `receiving-lines search failed (${res.status()})`).toBeTruthy();
  const body = await res.json();
  const line = body?.receiving_lines?.[0];
  expect(line, `no receiving row found for order ${ORDER}`).toBeTruthy();
  const id = Number(line.receiving_id ?? line.id);
  expect(Number.isFinite(id) && id > 0, `bad receiving_id for order ${ORDER}`).toBeTruthy();
  return id;
}

/** A real image filename + bytes from the NAS test folder. */
function pickFixture(): { name: string; bytes: Buffer } {
  const dir = path.join(NAS_MOUNT, NAS_DIR);
  const name = fs
    .readdirSync(dir)
    .find((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
  if (!name) throw new Error(`no image fixtures in ${dir}`);
  return { name, bytes: fs.readFileSync(path.join(dir, name)) };
}

test.describe('Unbox photos · /api/nas CRUD proxy', () => {
  test.skip(
    ({ }) => test.info().project.name === 'mobile',
    'API contract — run against the desktop project',
  );

  // ── READ: directory listing through the proxy ──────────────────────────────
  test('GET /api/nas lists the NAS test folder (same-origin read)', async ({ request }) => {
    const { name } = pickFixture();
    const res = await request.get(`${apiPath(NAS_DIR)}/`, {
      headers: { Accept: 'application/json' },
    });
    expect(res.ok(), `listing failed (${res.status()})`).toBeTruthy();
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    const names = (entries as Array<{ name: string }>).map((e) => e.name);
    expect(names, 'real test photo not present in proxied listing').toContain(name);
  });

  // ── READ: file bytes through the proxy ─────────────────────────────────────
  test('GET /api/nas/<file> streams image bytes', async ({ request }) => {
    const { name } = pickFixture();
    const res = await request.get(apiPath(`${NAS_DIR}/${name}`));
    expect(res.ok(), `file fetch failed (${res.status()})`).toBeTruthy();
    expect(res.headers()['content-type']).toMatch(/^image\//);
    expect((await res.body()).length).toBeGreaterThan(0);
  });

  // ── Guards: traversal + non-image write are rejected ───────────────────────
  test('rejects path traversal and non-image writes', async ({ request }) => {
    // The platform normalizes `..` before our guard, so the exact status varies
    // (401/403/404) — the security property is simply that nothing outside the
    // NAS root is ever served (no 2xx leak).
    const traversal = await request.get('/api/nas/%2e%2e/etc/passwd');
    expect(traversal.status(), 'traversal must not leak').toBeGreaterThanOrEqual(400);

    const nonImage = await request.put(apiPath(`${NAS_DIR}/__e2e_not_an_image.txt`), {
      data: Buffer.from('nope'),
      headers: { 'content-type': 'text/plain' },
    });
    expect(nonImage.status(), 'non-image write must be 400').toBe(400);
  });

  // ── Auth: the proxy is session-gated ───────────────────────────────────────
  test('GET /api/nas without a session is rejected', async () => {
    const baseURL = process.env.PW_BASE_URL || 'http://localhost:3000';
    // Use a raw cookieless fetch (Playwright's request context can follow the
    // sign-in redirect and mask the gate). redirect:'manual' so a 3xx bounce to
    // /signin shows as a 3xx, not its 200 HTML.
    const res = await fetch(`${baseURL}${apiPath(NAS_DIR)}`, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    // Gated = rejected (401/403) or bounced to sign-in (3xx) — never a 2xx listing.
    expect(res.status, `unauth got ${res.status}`).toBeGreaterThanOrEqual(400);
  });

  // ── WRITE: PUT → GET → DELETE round-trip through the proxy ──────────────────
  test('PUT then DELETE a captured photo (full CRUD)', async ({ request }) => {
    test.skip(READONLY, 'write verb not enabled on this NAS host (read-only)');
    const { bytes } = pickFixture();
    const dest = apiPath(`${NAS_DIR}/__e2e_${Date.now()}.jpg`);

    const put = await request.put(dest, {
      data: bytes,
      headers: { 'content-type': 'image/jpeg' },
    });
    expect([200, 201, 204], `PUT failed (${put.status()})`).toContain(put.status());

    const get = await request.get(dest);
    expect(get.ok(), `GET after PUT failed (${get.status()})`).toBeTruthy();
    expect(get.headers()['content-type']).toMatch(/^image\//);

    const del = await request.delete(dest);
    expect([200, 202, 204], `DELETE failed (${del.status()})`).toContain(del.status());

    const gone = await request.get(dest);
    expect(gone.status(), 'file should be gone after DELETE').toBe(404);
  });

  // ── ATTACH: a /api/nas URL binds to the real receiving row ─────────────────
  test('attach a /api/nas photo to receiving row for order ' + ORDER, async ({ request }) => {
    const receivingId = await resolveReceivingId(request);
    const { name } = pickFixture();
    const photoUrl = apiPath(`${NAS_DIR}/${name}`);

    const post = await request.post('/api/receiving-photos', {
      data: { receivingId, receivingLineId: null, photoUrl },
    });
    // 409 = already attached from a prior run; treat as success for idempotency.
    expect([200, 201, 409], `attach failed (${post.status()})`).toContain(post.status());

    let createdId: number | null = null;
    if (post.status() !== 409) {
      const body = await post.json();
      expect(body.success).toBe(true);
      expect(body.photo.photoUrl).toBe(photoUrl);
      createdId = body.photo.id;
    }

    const get = await request.get(`/api/receiving-photos?receivingId=${receivingId}&scope=po`);
    expect(get.ok()).toBeTruthy();
    const { photos } = await get.json();
    expect(
      (photos as Array<{ photoUrl: string }>).some((p) => p.photoUrl === photoUrl),
      'attached /api/nas URL not returned by GET',
    ).toBe(true);

    if (createdId) {
      const del = await request.delete(`/api/receiving-photos?id=${createdId}`);
      expect(del.ok(), `cleanup failed (${del.status()})`).toBeTruthy();
    }
  });
});

// ── Mobile: the Unbox tab renders (no white-screen / error boundary) ─────────
test.describe('Unbox tab renders without white screen', () => {
  test('mobile /m/receiving feed mounts', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile', 'mobile-only');
    await page.goto('/m/receiving');
    // The error boundary (src/app/m/error.tsx) renders this copy on a crash —
    // its absence is our "no white screen" assertion.
    await expect(page.getByText(/This screen hit an error/i)).toHaveCount(0);
    // The shell + feed mounted: the bottom-nav Unbox tab is present.
    await expect(page.getByRole('button', { name: /Unbox/i })).toBeVisible({ timeout: 15_000 });
  });
});
