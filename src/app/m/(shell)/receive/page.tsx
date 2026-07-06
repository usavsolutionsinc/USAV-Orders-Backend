'use client';

/**
 * /m/receive — Mobile receiving-door scan entry point.
 * Redesigned for 2026 Mobile Design System.
 */

import RedesignedMobileReceive from '@/components/mobile/redesign/Receive';

/** @deprecated Prefer `/m/triage` — kept for deep links. */
export default function MobileReceivePage() {
  return <RedesignedMobileReceive surface="triage" title="Triage" />;
}
