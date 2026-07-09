'use client';

import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { MobilePackingList } from '@/components/mobile/packer/MobilePackingList';
import { useAuth } from '@/contexts/AuthContext';

/**
 * /m/pack — Mobile packing surface living INSIDE the /m shell.
 *
 * Feed-only, mirroring the Unboxing receiving surface ({@link MobileReceivingList}):
 * NO scan bar / tracking entry, NO top banner, NO view switcher — just the
 * recent-packs feed ({@link MobilePackingList}, newest pinned at the bottom).
 * Each row's camera CTA jumps to /m/p/{packerLogId}/photos to add packing photos.
 *
 * The scan-driven flow ({@link MobilePackerFlow}) is the `trigger: 'scan'` mode
 * of this station; this surface is the `trigger: 'feed'` mode. The choice is an
 * owner knob on the pack node's config (STATION_CONFIG_SCHEMA `trigger`), edited
 * in the Studio. Until the published-node-config read seam exists on operator
 * surfaces, packing defaults to the feed here. The shared header lives in the
 * shell; the full desktop packer station still lives at /packer.
 */
export default function RedesignedMobilePack() {
  const { user } = useAuth();
  const packerId = user?.staffId ? String(user.staffId) : '';

  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      <div className="min-h-0 flex-1 pb-3">
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
