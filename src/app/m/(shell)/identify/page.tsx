'use client';

/**
 * /m/identify — Mobile "Identify by photo" intake page.
 *
 * Camera-first label identify for receiving / local-pickup. Open with
 * ?recvId=<id>&po=<ref> from a carton to add items by photographing their label.
 * Without recvId it identifies read-only (Add disabled).
 */
import { Suspense } from 'react';
import { MobileIdentify } from '@/components/mobile/identify/MobileIdentify';

export default function MobileIdentifyPage() {
  return (
    <Suspense fallback={<div className="h-[100dvh] w-full bg-[#0B0B0F]" />}>
      <MobileIdentify />
    </Suspense>
  );
}
