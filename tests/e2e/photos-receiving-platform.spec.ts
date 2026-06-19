import { test, expect } from '@playwright/test';

/**
 * Photos platform dual-read — receiving attach appears in:
 *   GET /api/receiving-photos
 *   GET /api/photos/library?receivingId=
 *   GET /api/receiving/po/list (photo_count on the PO row)
 *
 * Uses NAS-style attach (photoUrl) so no GCS credentials are required.
 */
const RECEIVING_ID = Number(process.env.PW_TEST_RECEIVING_ID || '1');

test.describe('Photos platform receiving dual-read', () => {
  test('attached receiving photo is listed by receiving-photos, library, and PO list', async ({
    request,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project only');

    const nasUrl = `http://nas.e2e.local:8088/platform/${Date.now()}.jpg`;

    const postRes = await request.post('/api/receiving-photos', {
      data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
    });
    expect(postRes.ok(), `POST failed with ${postRes.status()}`).toBeTruthy();
    expect(postRes.headers()['deprecation']).toMatch(/photos\/upload/i);
    const { photo } = await postRes.json();
    const photoId: number = photo.id;

    try {
      const recvRes = await request.get(
        `/api/receiving-photos?receivingId=${RECEIVING_ID}&scope=all`,
      );
      expect(recvRes.ok()).toBeTruthy();
      const recvBody = await recvRes.json();
      expect(
        (recvBody.photos as Array<{ id: number }>).some((p) => p.id === photoId),
      ).toBeTruthy();

      const libRes = await request.get(`/api/photos/library?receivingId=${RECEIVING_ID}&limit=50`);
      expect(libRes.ok()).toBeTruthy();
      const libBody = await libRes.json();
      expect(
        (libBody.photos as Array<{ id: number }>).some((p) => p.id === photoId),
      ).toBeTruthy();

      const poList = await request.get('/api/receiving/po/list?limit=250');
      expect(poList.ok()).toBeTruthy();
      const poBody = await poList.json();
      const row = (
        poBody.purchase_orders as Array<{ receiving_id: number; photo_count: number }>
      ).find((r) => Number(r.receiving_id) === RECEIVING_ID);
      expect(row, 'PO list row for test receiving id').toBeDefined();
      expect(Number(row!.photo_count)).toBeGreaterThan(0);
    } finally {
      const delRes = await request.delete(`/api/receiving-photos?id=${photoId}`);
      expect(delRes.ok()).toBeTruthy();
    }
  });
});
