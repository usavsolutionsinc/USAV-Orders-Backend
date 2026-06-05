'use client';

import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { MobilePackingList } from '@/components/mobile/packer/MobilePackingList';
import { useAuth } from '@/contexts/AuthContext';

/**
 * /m/pack — Mobile packing feed living INSIDE the /m shell.
 *
 * The recent-packs feed ({@link MobilePackingList}, reused verbatim), last 8.
 * The shared header lives in the shell. The full packer station (desktop table
 * + scan/camera flow) still lives at /packer for desktop.
 */
export default function RedesignedMobilePack() {
  const { user } = useAuth();
  const packerId = user?.staffId ? String(user.staffId) : '';

  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      {/* pb-20 keeps the newest (bottom-pinned) pack card clear of the fixed nav. */}
      <div className="min-h-0 flex-1 pb-20">
        {packerId ? (
          <MobilePackingList packerId={packerId} limit={25} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs font-black uppercase tracking-widest text-blue-300">
            Sign in to view packing
          </div>
        )}
      </div>
    </div>
  );
}
