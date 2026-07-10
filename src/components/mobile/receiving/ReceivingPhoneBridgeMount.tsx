'use client';

import { ReceivingShareToPhoneSheet } from '@/components/mobile/receiving/ReceivingShareToPhoneSheet';
import { ReceivingPhotoRequestCamera } from '@/components/mobile/receiving/ReceivingPhotoRequestCamera';
import { UnitPhotoRequestCamera } from '@/components/mobile/unit/UnitPhotoRequestCamera';

/**
 * Mount-only phone↔desktop receiving bridge. Subscribes to Ably on
 * `staffstation:{staffId}` (desktop scan / share) and routes the operator to
 * the capture surface. Mount once per app shell so `/receiving` mobile and
 * `/m/*` both get implicit pairing without duplicating listener logic.
 *
 * Also hosts the packer testing-label unit-photo receiver (`unit_photo_request`
 * → `/m/u/{id}/photos`), which self-gates on `UNIT_SCAN_PHOTOS`.
 */
export function ReceivingPhoneBridgeMount() {
  return (
    <>
      <ReceivingShareToPhoneSheet />
      <ReceivingPhotoRequestCamera />
      <UnitPhotoRequestCamera />
    </>
  );
}
