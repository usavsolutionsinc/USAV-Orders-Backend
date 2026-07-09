'use client';

/**
 * /m/triage — Mobile door-scan entry (mirrors desktop `/triage`).
 */

import RedesignedMobileReceive from '@/components/mobile/redesign/Receive';

export default function MobileTriageScanPage() {
  return <RedesignedMobileReceive surface="triage" title="Triage" />;
}
