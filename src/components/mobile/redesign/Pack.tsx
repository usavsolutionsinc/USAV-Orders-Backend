'use client';

import { useState } from 'react';
import { Package, History } from '@/components/Icons';
import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { MobilePackingList } from '@/components/mobile/packer/MobilePackingList';
import { MobilePackerFlow } from '@/components/mobile/packer/MobilePackerFlow';
import { useAuth } from '@/contexts/AuthContext';

type PackView = 'flow' | 'recent';

const VIEWS = [
  { id: 'flow' as const, label: 'Pack', icon: Package },
  { id: 'recent' as const, label: 'Recent', icon: History },
];

/**
 * /m/pack — Mobile packing surface living INSIDE the /m shell.
 *
 * Two modes (HorizontalButtonSlider):
 *   - Pack   — the scan-driven two-step packer flow ({@link MobilePackerFlow}):
 *              scan 1 → order details, scan 2 → what to pack (P1-MOB-01).
 *   - Recent — the recent-packs history feed ({@link MobilePackingList}),
 *              reused verbatim.
 *
 * The shared header lives in the shell. The full desktop packer station (table
 * + scan/camera flow) still lives at /packer.
 */
export default function RedesignedMobilePack() {
  const { user } = useAuth();
  const packerId = user?.staffId ? String(user.staffId) : '';
  const [view, setView] = useState<PackView>('flow');

  return (
    <div className={`flex h-full flex-col ${TOKENS.colors.background}`}>
      <div className="px-4 pt-2">
        <HorizontalButtonSlider
          variant="segmented"
          aria-label="Packing view"
          value={view}
          onChange={(id) => setView(id as PackView)}
          items={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon }))}
        />
      </div>

      {/* Nav moved to the left drawer — content runs to the bottom (shell pb-safe). */}
      <div className="min-h-0 flex-1 pb-3">
        {view === 'flow' ? (
          <MobilePackerFlow />
        ) : packerId ? (
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
