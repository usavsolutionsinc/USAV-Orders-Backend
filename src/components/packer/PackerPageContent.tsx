'use client';

import { useUIMode } from '@/design-system/providers/UIModeProvider';
import PackerDashboard from '@/components/PackerDashboard';
import { MobilePackerDashboard } from '@/components/mobile/packer/MobilePackerDashboard';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

interface PackerPageContentProps {
  packerId: string;
}

/**
 * PackerPageContent — client-side desktop/mobile branch for the packer page.
 *
 * Desktop → existing PackerDashboard (table + details panel).
 * Mobile  → MobilePackerDashboard (packing station → history → details).
 */
export function PackerPageContent({ packerId }: PackerPageContentProps) {
  const { isMobile } = useUIMode();
  useRealtimeToasts('packer');

  if (isMobile) {
    return <MobilePackerDashboard packerId={packerId} />;
  }

  return <PackerDashboard packerId={packerId} />;
}
