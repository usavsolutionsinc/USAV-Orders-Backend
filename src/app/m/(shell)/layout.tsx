'use client';

import { RedesignedMobileShell } from '@/components/mobile/redesign/MobileShell';

export default function MobileShellLayout({ children }: { children: React.ReactNode }) {
  return <RedesignedMobileShell>{children}</RedesignedMobileShell>;
}
