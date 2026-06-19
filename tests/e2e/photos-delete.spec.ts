import { test, expect } from '@playwright/test';

const RECEIVING_ID = Number(process.env.PW_TEST_RECEIVING_ID || '1');

test.describe('Photo delete API', () => {
  test('DELETE /api/receiving-photos removes photo from GET list', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project only');

    const nasUrl = `http://nas.e2e.local:8088/delete/${Date.now()}.jpg`;
    const postRes = await request.post('/api/receiving-photos', {
      data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
    });
    expect(postRes.ok()).toBeTruthy();
    const photoId: number = (await postRes.json()).photo.id;

    const delRes = await request.delete(`/api/receiving-photos?id=${photoId}`);
    expect(delRes.ok()).toBeTruthy();

    const getRes = await request.get(
      `/api/receiving-photos?receivingId=${RECEIVING_ID}&scope=all`,
    );
    expect(getRes.ok()).toBeTruthy();
    const { photos } = await getRes.json();
    expect(
      (photos as Array<{ id: number }>).some((p) => p.id === photoId),
    ).toBeFalsy();
  });
});
