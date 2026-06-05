'use client';

/**
 * Mobile receiving feed — `/m/receiving`.
 *
 * Thin wrapper over the shared MobileReceivingList (the same feed the "perfect"
 * /receiving page uses): the last 8 receiving lines pinned at the bottom, tap a
 * row for the carton sheet / photo capture. The header lives in the shell.
 */

import { motion } from 'framer-motion';
import { Plus } from '@/components/Icons';
import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';
import { useRouter } from 'next/navigation';

export default function RedesignedMobileReceivingLive() {
  const router = useRouter();

  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      {/* pb-20 keeps the newest (bottom-pinned) row clear of the fixed nav. */}
      <div className="min-h-0 flex-1 pb-20">
        <MobileReceivingList limit={8} />
      </div>

      {/* FAB → start a new receive (door scan). */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => router.push('/m/receive')}
        aria-label="New receive"
        className="fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl"
      >
        <Plus className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
