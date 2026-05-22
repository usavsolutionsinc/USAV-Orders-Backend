'use client';

import { useRouter } from 'next/navigation';
import { ClipboardList, List } from '@/components/Icons';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';

interface MobileReceivingViewPillsProps {
  active: 'lines' | 'pos';
}

const ITEMS: HorizontalSliderItem[] = [
  { id: 'lines', label: 'Live',    icon: ClipboardList },
  { id: 'pos',   label: 'History', icon: List },
];

const ROUTES: Record<MobileReceivingViewPillsProps['active'], string> = {
  lines: '/m/receiving',
  pos: '/m/receiving/history',
};

/**
 * Pill switcher between the live receiving line feed (/m/receiving) and the
 * search/scan history surface (/m/receiving/history). Both routes stay under
 * `/m/` so the edge proxy's `/receiving → /m/receiving` rewrite for phone UAs
 * doesn't bounce the user off the active pill.
 */
export function MobileReceivingViewPills({ active }: MobileReceivingViewPillsProps) {
  const router = useRouter();
  return (
    <HorizontalButtonSlider
      items={ITEMS}
      value={active}
      onChange={(id) => {
        const next = ROUTES[id as MobileReceivingViewPillsProps['active']];
        if (next) router.push(next);
      }}
      variant="floating"
      size="lg"
      aria-label="Receiving view"
    />
  );
}
