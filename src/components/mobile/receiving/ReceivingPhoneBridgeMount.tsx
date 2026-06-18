'use client';

import { ReceivingShareToPhoneSheet } from '@/components/mobile/receiving/ReceivingShareToPhoneSheet';
import { ReceivingPhotoRequestCamera } from '@/components/mobile/receiving/ReceivingPhotoRequestCamera';

/**
 * Mount-only phone↔desktop receiving bridge. Subscribes to Ably on
 * `staffstation:{staffId}` (desktop scan / share) and routes the operator to
 * the capture surface. Mount once per app shell so `/receiving` mobile and
 * `/m/*` both get implicit pairing without duplicating listener logic.
 */
export function ReceivingPhoneBridgeMount() {
  return (
    <>
      <ReceivingShareToPhoneSheet />
      <ReceivingPhotoRequestCamera />
    </>
  );
}
