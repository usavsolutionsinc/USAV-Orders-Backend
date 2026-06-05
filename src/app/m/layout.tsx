'use client';

/**
 * Layout shared by every /m/* route. 
 * Updated to use the 2026 Mobile Design System Shell.
 */

import { RedesignedMobileShell } from '@/components/mobile/redesign/MobileShell';

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RedesignedMobileShell>{children}</RedesignedMobileShell>;
}
