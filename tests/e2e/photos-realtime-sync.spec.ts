import { test, expect } from '@playwright/test';

/**
 * After a photo attach, a fresh GET (simulating desktop strip refetch) includes
 * the new row. Realtime Ably refresh is wired via useReceivingPhotosRealtimeRefresh.
 */
const RECEIVING_ID = Number(process.env.PW_TEST_RECEIVING_ID || '1');

test.describe('Photos sync after attach', () => {
  test('GET receiving-photos reflects attach on immediate refetch', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project only');

    const nasUrl = `http://nas.e2e.local:8088/sync/${Date.now()}.jpg`;
    const postRes = await request.post('/api/receiving-photos', {
      data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
    });
    expect(postRes.ok()).toBeTruthy();
    const photoId: number = (await postRes.json()).photo.id;

    try {
      const getRes = await request.get(
        `/api/receiving-photos?receivingId=${RECEIVING_ID}&scope=all`,
      );
      expect(getRes.ok()).toBeTruthy();
      const { photos } = await getRes.json();
      expect(
        (photos as Array<{ id: number; photoUrl: string }>).some((p) => p.id === photoId),
      ).toBeTruthy();
    } finally {
      await request.delete(`/api/receiving-photos?id=${photoId}`);
    }
  });
});
