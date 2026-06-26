'use client';

/**
 * Mobile receiving feed — `/m/receiving`.
 *
 * Unboxing (default) is the shared MobileReceivingList — the same feed the
 * desktop /receiving "Unboxing" rail uses. `?mode=local-pickup` and
 * `?mode=repair` render starter surfaces for those receiving sub-flows (the
 * drawer's Receiving group routes here). The header lives in the shell; the
 * body runs to the bottom (shell `pb-safe`) now that the bottom nav is gone.
 */

import type { ComponentType } from 'react';
import { MapPin, Wrench } from '@/components/Icons';
import { TOKENS } from '@/components/mobile/redesign/DesignSystem';
import { MobileReceivingList } from '@/components/mobile/receiving/MobileReceivingList';

function ModeStarter({
  Icon,
  title,
  blurb,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  blurb: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-white px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 ring-1 ring-inset ring-blue-100">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-sm font-black uppercase tracking-[0.18em] text-gray-800">{title}</p>
      <p className="max-w-[280px] text-caption font-semibold text-gray-500">{blurb}</p>
    </div>
  );
}

export default function RedesignedMobileReceivingLive({ mode }: { mode?: string }) {
  let body;
  if (mode === 'local-pickup') {
    body = (
      <ModeStarter
        Icon={MapPin}
        title="Local Pickup"
        blurb="Customer pickup orders will show here. Start a local pickup from the desktop receiving station."
      />
    );
  } else if (mode === 'repair') {
    body = (
      <ModeStarter
        Icon={Wrench}
        title="Repair Service"
        blurb="Repair intakes will show here. Log a repair from the desktop walk-in station."
      />
    );
  } else {
    body = <MobileReceivingList limit={25} />;
  }

  return (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${TOKENS.colors.background}`}>
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
