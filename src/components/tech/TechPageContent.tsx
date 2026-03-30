'use client';

import { useUIMode } from '@/design-system/providers/UIModeProvider';
import TechDashboard from '@/components/TechDashboard';
import { MobileTechDashboard } from '@/components/mobile/tech/MobileTechDashboard';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

interface TechPageContentProps {
  techId: string;
}

/**
 * TechPageContent — client-side desktop/mobile branch for the tech page.
 *
 * Desktop → existing TechDashboard (sidebar station + right panel).
 * Mobile  → MobileTechDashboard (full-screen MobileStationTesting).
 */
export function TechPageContent({ techId }: TechPageContentProps) {
  const { isMobile } = useUIMode();
  useRealtimeToasts('tech');

  if (isMobile) {
    return <MobileTechDashboard techId={techId} />;
  }

  return <TechDashboard techId={techId} />;
}
