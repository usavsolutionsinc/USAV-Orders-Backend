'use client';

/**
 * Mobile receiving feed — `/m/receiving`.
 *
 * Thin wrapper over the shared MobileReceivingList (the same feed the "perfect"
 * /receiving page uses): the last 8 receiving lines pinned at the bottom, tap a
 * row for the carton sheet / photo capture. The header lives in the shell.
 */

import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';

export default function RedesignedMobileReceivingLive() {
  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      {/* pb-20 keeps the newest (bottom-pinned) row clear of the fixed nav. */}
      <div className="min-h-0 flex-1 pb-20">
        <MobileReceivingList limit={25} />
      </div>
    </div>
  );
}
