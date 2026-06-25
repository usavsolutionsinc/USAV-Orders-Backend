'use client';

/**
 * Mobile homepage — the "Recent" tab.
 *
 * Recent shows the shared receiving feed (same source as the Receiving tab),
 * capped at the last 8 so it fills one phone screen and loads fast. Previously
 * this read /api/scan/history, which is gated on an inventory permission floor
 * staff lack — so it was permanently blank. Now it reuses MobileReceivingList,
 * which all the mobile feeds share.
 */

import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { TOKENS } from '@/components/mobile/redesign/DesignSystem';

export default function RedesignedMobileDashboard() {
  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      {/* Header lives in the shell; nav moved to the left drawer, so the feed
          runs to the bottom (shell's pb-safe clears the home indicator). */}
      <div className="min-h-0 flex-1 pb-3">
        <MobileReceivingList limit={25} />
      </div>
    </div>
  );
}
