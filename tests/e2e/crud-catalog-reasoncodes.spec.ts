import { test, expect } from '@playwright/test';

/**
 * Full-CRUD lifecycle coverage for the self-contained config resources added
 * in the CRUD initiative:
 *   - /api/sku-catalog   (+ /[id])
 *   - /api/reason-codes  (+ /[id])
 *
 * API-level tests using the authenticated `request` fixture — the session
 * cookie comes from tests/.auth/admin.json (global-setup signs in as an admin).
 * No env vars required: every test creates uniquely-named rows and deletes them
 * on the way out (finally blocks), so the suite is idempotent and leaves no
 * residue.
 */

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test.describe('sku-catalog CRUD', () => {
  test('create → read → update → delete lifecycle', async ({ request }) => {
    const sku = `E2E-SKU-${uniq()}`;
    let id: number | undefined;
    try {
      // CREATE
      const createRes = await request.post('/api/sku-catalog', {
        data: { sku, productTitle: 'E2E Widget', category: 'E2E' },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      expect(created.success).toBe(true);
      expect(created.catalog?.sku).toBe(sku);
      id = created.catalog.id;

      // READ
      const getRes = await request.get(`/api/sku-catalog/${id}`);
      expect(getRes.status()).toBe(200);
      const got = await getRes.json();
      expect(got.success).toBe(true);
      expect(got.catalog?.id).toBe(id);

      // UPDATE
      const patchRes = await request.patch(`/api/sku-catalog/${id}`, {
        data: { productTitle: 'E2E Widget v2' },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).catalog?.product_title).toBe('E2E Widget v2');

      // DELETE
      const delRes = await request.delete(`/api/sku-catalog/${id}`);
      expect(delRes.status()).toBe(200);
      expect((await delRes.json()).success).toBe(true);
      id = undefined;
    } finally {
      if (id) await request.delete(`/api/sku-catalog/${id}`);
    }
  });

  test('duplicate active sku → 409', async ({ request }) => {
    const sku = `E2E-DUP-${uniq()}`;
    let id: number | undefined;
    try {
      const first = await request.post('/api/sku-catalog', { data: { sku, productTitle: 'dup' } });
      expect(first.status()).toBe(201);
      id = (await first.json()).catalog.id;

      const second = await request.post('/api/sku-catalog', { data: { sku, productTitle: 'dup2' } });
      expect(second.status()).toBe(409);
    } finally {
      if (id) await request.delete(`/api/sku-catalog/${id}`);
    }
  });

  test('invalid body → 400 INVALID_BODY', async ({ request }) => {
    const res = await request.post('/api/sku-catalog', { data: { productTitle: 'no sku' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('INVALID_BODY');
  });

  test('unknown id → 404', async ({ request }) => {
    const res = await request.get('/api/sku-catalog/999999999');
    expect(res.status()).toBe(404);
  });

  test('sku can be recreated after delete (reactivation)', async ({ request }) => {
    const sku = `E2E-REACT-${uniq()}`;
    let id: number | undefined;
    try {
      const a = await request.post('/api/sku-catalog', { data: { sku, productTitle: 'r1' } });
      expect(a.status()).toBe(201);
      id = (await a.json()).catalog.id;

      const del = await request.delete(`/api/sku-catalog/${id}`);
      expect(del.status()).toBe(200);

      const b = await request.post('/api/sku-catalog', { data: { sku, productTitle: 'r2' } });
      expect(b.status()).toBe(201);
      id = (await b.json()).catalog.id;
    } finally {
      if (id) await request.delete(`/api/sku-catalog/${id}`);
    }
  });
});

test.describe('reason-codes CRUD', () => {
  test('create → read → update → delete lifecycle', async ({ request }) => {
    const code = `E2E_RC_${uniq().replace(/-/g, '_')}`;
    let id: number | undefined;
    try {
      const createRes = await request.post('/api/reason-codes', {
        data: { code, label: 'E2E reason', category: 'adjustment', direction: 'either' },
      });
      expect(createRes.status()).toBe(201);
      const created = await createRes.json();
      expect(created.success).toBe(true);
      expect(created.reason_code?.code).toBe(code);
      id = created.reason_code.id;

      const getRes = await request.get(`/api/reason-codes/${id}`);
      expect(getRes.status()).toBe(200);
      expect((await getRes.json()).reason_code?.id).toBe(id);

      const patchRes = await request.patch(`/api/reason-codes/${id}`, {
        data: { label: 'E2E reason v2' },
      });
      expect(patchRes.status()).toBe(200);
      expect((await patchRes.json()).reason_code?.label).toBe('E2E reason v2');

      const delRes = await request.delete(`/api/reason-codes/${id}`);
      expect(delRes.status()).toBe(200);
      const deletedId = id;
      id = undefined;

      // Soft-deleted → no longer in the active list.
      const listRes = await request.get('/api/reason-codes');
      const list = await listRes.json();
      const stillThere = (list.reason_codes ?? []).some((r: any) => r.id === deletedId);
      expect(stillThere).toBe(false);
    } finally {
      if (id) await request.delete(`/api/reason-codes/${id}`);
    }
  });

  test('duplicate code → 409', async ({ request }) => {
    const code = `E2E_DUP_${uniq().replace(/-/g, '_')}`;
    let id: number | undefined;
    try {
      const first = await request.post('/api/reason-codes', {
        data: { code, label: 'a', category: 'adjustment' },
      });
      expect(first.status()).toBe(201);
      id = (await first.json()).reason_code.id;

      const second = await request.post('/api/reason-codes', {
        data: { code, label: 'b', category: 'adjustment' },
      });
      expect(second.status()).toBe(409);
    } finally {
      if (id) await request.delete(`/api/reason-codes/${id}`);
    }
  });

  test('invalid body → 400 INVALID_BODY', async ({ request }) => {
    const res = await request.post('/api/reason-codes', { data: { label: 'no code' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('INVALID_BODY');
  });

  test('unknown id → 404', async ({ request }) => {
    const res = await request.get('/api/reason-codes/999999999');
    expect(res.status()).toBe(404);
  });
});
