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
  lines: '/receiving',
  pos: '/m/receiving',
};

/**
 * Pill switcher between the live receiving line feed (/receiving) and the
 * search/scan surface (/m/receiving). Uses the same nav-variant pill shape
 * as the in-app filter sliders for consistency.
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
