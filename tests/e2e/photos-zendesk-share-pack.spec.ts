import { test, expect } from '@playwright/test';

/**
 * Zendesk claim → photo share pack (API contract).
 *
 * When Zendesk is configured and a claim succeeds with attached photos, the
 * route returns sharePackUrl for vendor sharing. Skips when Zendesk is offline.
 */
const RECEIVING_ID = Number(process.env.PW_TEST_RECEIVING_ID || '1');

test.describe('Zendesk claim share pack', () => {
  test('successful claim with photos returns sharePackUrl', async ({ request }) => {
    test.skip(test.info().project.name === 'mobile', 'API test — desktop project only');

    const nasUrl = `http://nas.e2e.local:8088/claim/${Date.now()}.jpg`;
    const postRes = await request.post('/api/receiving-photos', {
      data: { receivingId: RECEIVING_ID, receivingLineId: null, photoUrl: nasUrl },
    });
    expect(postRes.ok()).toBeTruthy();
    const { photo } = await postRes.json();
    const photoId: number = photo.id;

    try {
      const claimRes = await request.post('/api/receiving/zendesk-claim', {
        data: {
          receivingId: RECEIVING_ID,
          claimType: 'damage',
          reason: 'E2E share pack smoke test',
          attachPhotoIds: [photoId],
        },
      });
      const data = await claimRes.json();

      if (claimRes.status() === 503 || !data.success) {
        test.skip(true, 'Zendesk not configured or claim bridge unavailable');
        return;
      }

      expect(typeof data.sharePackUrl).toBe('string');
      expect(String(data.sharePackUrl)).toMatch(/\/share\/photos\//);

      const shareRes = await request.get(
        String(data.sharePackUrl).replace(/^https?:\/\/[^/]+/, ''),
      );
      expect(shareRes.ok()).toBeTruthy();
    } finally {
      await request.delete(`/api/receiving-photos?id=${photoId}`);
    }
  });
});
