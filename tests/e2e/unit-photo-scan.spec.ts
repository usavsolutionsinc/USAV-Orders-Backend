/**
 * Packer testing-label unit-photo scan — API contract + full round-trip.
 *
 * Covers the feature from docs/todo/packer-testing-photo-scan-timeline-plan.md:
 * a printed unit-label scan resolves a serial_units.id, the phone uploads
 * SERIAL_UNIT `testing_photo`s, and the unit's detail-pane timeline pairs them
 * with the receiving UNBOX photos (via serial_unit_provenance).
 *
 * Two tiers:
 *   • Contract tests (always run) — the new/changed endpoints exist, are
 *     auth-gated, 404 on unknown units, and `/api/photos/upload` accepts the
 *     SERIAL_UNIT entity type (the regression guard for the wiring). No GCS,
 *     no seed data required → deterministic.
 *   • Round-trip (gated E2E_PHOTOS_GCS=1) — discover a real receiving-attached
 *     unit, upload a testing photo, assert it lands in the timeline's `testing`
 *     bucket, then delete it (non-destructive). The optional UI leg
 *     (E2E_UNIT_PHOTOS_UI=1, dev server booted with
 *     NEXT_PUBLIC_UNIT_SCAN_PHOTOS=1) asserts the thumbnail renders in the pane.
 *
 * Auth is the admin session minted by global-setup (admin short-circuits to
 * every permission, incl. tech.scan_serial + sku_stock.view).
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

test.use({ storageState: 'tests/.auth/admin.json' });

// Minimal valid 1×1 JPEG. Server-side thumbnailing degrades gracefully, so
// only the JPEG magic + image/jpeg mime are load-bearing here.
const TINY_JPEG = Buffer.from(
  '/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  'base64',
);

const UNKNOWN_UNIT_ID = 999999999;

/** Find any receiving-attached serial unit in the dogfood org, or null. */
async function findSerialUnit(
  request: APIRequestContext,
): Promise<{ serialUnitId: number; serial: string } | null> {
  const queries = [
    'view=recent&include=serials&limit=100',
    'workflow_status=MATCHED&include=serials&limit=200',
    'include=serials&limit=200',
  ];
  for (const q of queries) {
    const res = await request.get(`/api/receiving-lines?${q}`);
    if (!res.ok()) continue;
    const body = await res.json();
    const lines: Array<{ serials?: Array<{ id?: number; serial_number?: string }> }> =
      body.receiving_lines ?? [];
    for (const line of lines) {
      const s = (line.serials ?? []).find((x) => Number(x?.id) > 0 && !!x?.serial_number);
      if (s) return { serialUnitId: Number(s.id), serial: String(s.serial_number) };
    }
  }
  return null;
}

test.describe('Unit photo scan — API contracts (always run)', () => {
  test('unknown unit → handler 404 (JSON body) on both /photos and /timeline-photos', async ({
    request,
  }) => {
    // Assert the JSON `{ success:false }` body — proves OUR route handler ran and
    // 404'd on the unknown unit, not a Next "route not found" HTML 404.
    const photos = await request.get(`/api/serial-units/${UNKNOWN_UNIT_ID}/photos`);
    expect(photos.status()).toBe(404);
    expect((await photos.json()).success).toBe(false);

    const timeline = await request.get(`/api/serial-units/${UNKNOWN_UNIT_ID}/timeline-photos`);
    expect(timeline.status()).toBe(404);
    expect((await timeline.json()).success).toBe(false);
  });

  test('/api/photos/upload accepts the SERIAL_UNIT entity type (wiring regression guard)', async ({
    request,
  }) => {
    // SERIAL_UNIT is a recognized entity type → the route passes entityType +
    // permission and only rejects the MISSING FILE (not the entity type).
    const noFile = await request.post('/api/photos/upload', {
      multipart: { entityType: 'SERIAL_UNIT', entityId: '1' },
    });
    expect(noFile.status()).toBe(400);
    const noFileBody = JSON.stringify(await noFile.json().catch(() => ({})));
    expect(noFileBody).toMatch(/file/i);
    expect(noFileBody).not.toMatch(/invalid entitytype/i);

    // Contrast: a bogus entity type IS rejected as such.
    const bogus = await request.post('/api/photos/upload', {
      multipart: { entityType: 'NOT_A_REAL_TYPE', entityId: '1' },
    });
    expect(bogus.status()).toBe(400);
    expect(JSON.stringify(await bogus.json().catch(() => ({})))).toMatch(/invalid entitytype/i);
  });

  test('resolve-batch degrade: unknown serial → serial_unit_id null (the scan gate no-op)', async ({
    request,
  }) => {
    // The desktop fires a phone photo request ONLY when a unit resolves; an
    // unknown serial comes back with a null id so no request is fired.
    const res = await request.post('/api/serial-units/resolve-batch', {
      data: { serials: ['E2E-UNIT-PHOTO-NO-SUCH-SERIAL'] },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.units[0].serial_unit_id).toBeNull();
    expect(j.units[0].unit_uid).toBeNull();
  });

  test('mobile capture route /m/unit-photos/[id] is registered (200, not the route-group 404)', async ({
    request,
  }) => {
    // The route must resolve under (immersive) — a 404 here means the
    // route-group conflict with (shell)/u/[id] regressed. 200 = registered.
    const res = await request.get('/m/unit-photos/123');
    expect(res.status()).toBe(200);
  });
});

test.describe('Unit photo scan — full round-trip', () => {
  test.skip(!process.env.E2E_PHOTOS_GCS, 'Set E2E_PHOTOS_GCS=1 (GCS configured) to run the upload round-trip');

  test('upload a testing photo → it pairs into the unit timeline → cleanup', async ({ request }) => {
    const unit = await findSerialUnit(request);
    test.skip(unit === null, 'no receiving-attached serial unit found in this env to photograph');
    const { serialUnitId } = unit!;

    // The desktop resolve contract: /photos returns the canonical unit_id.
    const resolve = await request.get(`/api/serial-units/${serialUnitId}/photos`);
    expect(resolve.status()).toBe(200);
    expect((await resolve.json()).unit_id).toBe(serialUnitId);

    // Phone upload path: GCS-primary, SERIAL_UNIT, photoType=testing_photo.
    const upload = await request.post('/api/photos/upload', {
      multipart: {
        entityType: 'SERIAL_UNIT',
        entityId: String(serialUnitId),
        photoType: 'testing_photo',
        file: { name: 'e2e-testing.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    const uploaded = await upload.json();
    const uploadedId = Number(uploaded.id);
    expect(uploadedId).toBeGreaterThan(0);

    // Everything after a successful upload is inside try/finally so the E2E
    // photo is ALWAYS deleted from the real unit, even on an assertion failure.
    try {
      // The display URL is a signed GCS URL (gcs provider) OR the
      // /api/photos/{id}/content fallback — either way, a real URL.
      expect(String(uploaded.url || '')).toMatch(/^https?:\/\/|^\/api\/photos\//);

      // The pairing query surfaces it in the unit timeline's `testing` bucket
      // with the deterministic content-route media urls EventTimeline renders.
      const timeline = await request.get(`/api/serial-units/${serialUnitId}/timeline-photos`);
      expect(timeline.status()).toBe(200);
      const photos: Array<{ photoId: number; source: string; thumbUrl: string; fullUrl: string }> =
        (await timeline.json()).photos ?? [];
      const mine = photos.find((p) => Number(p.photoId) === uploadedId);
      expect(mine, 'uploaded testing photo should appear in the unit timeline').toBeTruthy();
      expect(mine!.source).toBe('testing');
      expect(mine!.thumbUrl).toBe(`/api/photos/${uploadedId}/content?variant=thumb`);
      expect(mine!.fullUrl).toBe(`/api/photos/${uploadedId}/content`);
    } finally {
      // Non-destructive: remove the E2E photo we added to a real unit.
      const del = await request.delete(`/api/photos/${uploadedId}`);
      expect(del.ok()).toBeTruthy();
    }
  });

  test('unit detail pane renders the paired photo thumbnail', async ({ request, page }) => {
    test.skip(
      !process.env.E2E_UNIT_PHOTOS_UI,
      'Set E2E_UNIT_PHOTOS_UI=1 with the dev server booted NEXT_PUBLIC_UNIT_SCAN_PHOTOS=1',
    );
    const unit = await findSerialUnit(request);
    test.skip(unit === null, 'no receiving-attached serial unit found in this env');
    const { serialUnitId } = unit!;

    // Seed one testing photo so the "Photos" timeline section has content.
    const upload = await request.post('/api/photos/upload', {
      multipart: {
        entityType: 'SERIAL_UNIT',
        entityId: String(serialUnitId),
        photoType: 'testing_photo',
        file: { name: 'e2e-testing-ui.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
      },
    });
    expect(upload.status()).toBe(200);
    const uploadedId = Number((await upload.json()).id);

    try {
      await page.goto(`/products?view=labels&labelsView=recent&historyId=${serialUnitId}`);
      // The SerialUnitTimelineSection ("Photos") renders the media strip.
      await expect(page.getByRole('heading', { name: /photos/i })).toBeVisible({ timeout: 15_000 });
      const thumb = page.locator(`a[href*="/api/photos/${uploadedId}/content"] img`).first();
      await expect(thumb).toBeVisible({ timeout: 15_000 });
    } finally {
      const del = await request.delete(`/api/photos/${uploadedId}`);
      expect(del.ok()).toBeTruthy();
    }
  });
});
