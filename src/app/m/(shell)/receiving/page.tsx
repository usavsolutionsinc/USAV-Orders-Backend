'use client';

/**
 * Mobile receiving live feed — `/m/receiving`.
 * Redesigned for 2026 Mobile Design System.
 *
 * `?mode=` selects the receiving sub-surface (drawer → Unboxing / Local Pickup /
 * Repair). Read here via useSearchParams (wrapped in Suspense per Next) and
 * handed to the feed component, which branches to the matching view.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RedesignedMobileReceivingLive from '@/components/mobile/redesign/ReceivingLive';

function MobileReceivingLiveInner() {
  const mode = useSearchParams()?.get('mode') ?? undefined;
  return <RedesignedMobileReceivingLive mode={mode} />;
}

export default function MobileReceivingLivePage() {
  return (
    <Suspense fallback={null}>
      <MobileReceivingLiveInner />
    </Suspense>
  );
}
