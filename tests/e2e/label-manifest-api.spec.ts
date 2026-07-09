/**
 * Label manifests + print-job ledger + batch UID resolver — API lifecycle.
 *
 * Drives the serial↔label pairing Phase 2/3 backend end-to-end against the live
 * (migrated) DB: create → seal (idempotent) → get-by-uid → dissolve for a
 * manifest; the read-only batch UID resolver; and the client-print ledger bridge
 * with its (org, client_event_id) idempotency. Auth is the admin session minted
 * by global-setup (admin short-circuits to every permission, incl. the new
 * label.manifest.manage + print.label).
 */

import { test, expect } from '@playwright/test';

test.use({ storageState: 'tests/.auth/admin.json' });

test.describe('Label manifests + print ledger API', () => {
  test('manifest lifecycle: create → seal (idempotent) → get-by-uid → dissolve', async ({
    request,
  }) => {
    // Create an OPEN manifest with no seed units.
    const created = await request.post('/api/label-manifests', {
      data: { manifestType: 'PREBOX', sku: 'E2E-KIT', notes: 'e2e smoke' },
    });
    expect(created.status()).toBe(201);
    const cj = await created.json();
    expect(cj.ok).toBe(true);
    const id = cj.manifest.id as number;
    const uid = cj.manifest.manifest_uid as string;
    expect(uid).toMatch(/^KIT-/);
    expect(cj.manifest.status).toBe('OPEN');
    expect(cj.manifest.items).toHaveLength(0);

    // GET by numeric id resolves the same manifest.
    const byId = await request.get(`/api/label-manifests/${id}`);
    expect(byId.status()).toBe(200);
    expect((await byId.json()).manifest.manifest_uid).toBe(uid);

    // Seal → returns the uid to print + status SEALED.
    const sealed = await request.post(`/api/label-manifests/${id}/seal`);
    expect(sealed.status()).toBe(200);
    const sj = await sealed.json();
    expect(sj.ok).toBe(true);
    expect(sj.manifest_uid).toBe(uid);
    expect(sj.manifest.status).toBe('SEALED');

    // Re-seal is idempotent — still 200 SEALED (never re-mints the uid).
    const reseal = await request.post(`/api/label-manifests/${id}/seal`);
    expect(reseal.status()).toBe(200);
    const rj = await reseal.json();
    expect(rj.manifest.status).toBe('SEALED');
    expect(rj.manifest_uid).toBe(uid);

    // GET by the KIT- uid (the scan path) resolves the same manifest.
    const byUid = await request.get(`/api/label-manifests/${encodeURIComponent(uid)}`);
    expect(byUid.status()).toBe(200);
    expect((await byUid.json()).manifest.id).toBe(id);

    // Dissolve → DISSOLVED (frees its units); idempotent under retry.
    const dissolved = await request.post(`/api/label-manifests/${id}/dissolve`);
    expect(dissolved.status()).toBe(200);
    expect((await dissolved.json()).manifest.status).toBe('DISSOLVED');
    const redissolve = await request.post(`/api/label-manifests/${id}/dissolve`);
    expect(redissolve.status()).toBe(200);
    expect((await redissolve.json()).manifest.status).toBe('DISSOLVED');
  });

  test('resolve-batch echoes each serial with a null uid for unknown units', async ({ request }) => {
    const res = await request.post('/api/serial-units/resolve-batch', {
      data: { serials: ['E2E-NO-SUCH-SERIAL-123', 'E2E-NO-SUCH-SERIAL-456'] },
    });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.units).toHaveLength(2);
    expect(j.units[0].serial).toBe('E2E-NO-SUCH-SERIAL-123');
    expect(j.units[0].unit_uid).toBeNull();
    expect(j.units[0].serial_unit_id).toBeNull();
  });

  test('label-print-jobs bridge records a job and is idempotent per client_event_id', async ({
    request,
  }) => {
    const cid = `e2e-ledger-${Date.now()}`;
    const body = {
      jobs: [
        {
          jobType: 'MANIFEST',
          unitUid: 'KIT-E2E-9999',
          qrPayload: 'KIT-E2E-9999',
          templateId: 'prebox_master',
          clientEventId: cid,
        },
      ],
    };
    const first = await request.post('/api/label-print-jobs', { data: body });
    expect(first.status()).toBe(200);
    const fj = await first.json();
    expect(fj.ok).toBe(true);
    expect(fj.recorded).toBe(1);
    const firstId = fj.jobs[0].id as number;

    // Retry with the SAME clientEventId collapses to the original row (no dup).
    const second = await request.post('/api/label-print-jobs', { data: body });
    expect(second.status()).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.jobs[0].id).toBe(firstId);
  });
});
