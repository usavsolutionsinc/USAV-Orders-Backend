'use client';

import { type ReactNode } from 'react';
import { useUIModeOptional } from '../providers/UIModeProvider';
import { DesktopShell, type DesktopShellProps } from './desktop/DesktopShell';
import { MobileShell, type MobileShellProps } from './mobile/MobileShell';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResponsiveShellProps {
  /** Props for the desktop shell layout. */
  desktop: Omit<DesktopShellProps, 'children'>;
  /** Props for the mobile shell layout. */
  mobile: Omit<MobileShellProps, 'children'>;
  /** Shared content rendered inside whichever shell is active. */
  children: ReactNode;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ResponsiveShell — auto-selects DesktopShell or MobileShell based on
 * the current UI mode from `UIModeProvider`.
 *
 * Usage:
 *   <UIModeProvider>
 *     <ResponsiveShell
 *       desktop={{ sidebar: <DashboardSidebar /> }}
 *       mobile={{
 *         toolbar: { title: 'Dashboard' },
 *         navItems: mobileNavItems,
 *         activeNavId: 'dashboard',
 *         onNavigate: handleNav,
 *       }}
 *     >
 *       <PageContent />
 *     </ResponsiveShell>
 *   </UIModeProvider>
 *
 * If no UIModeProvider is found, defaults to desktop.
 *
 * For pages that need completely different mobile content (not just layout),
 * use `useUIMode()` directly and render separate component trees:
 *
 *   const { isMobile } = useUIMode();
 *   if (isMobile) return <PackerMobilePage />;
 *   return <PackerDesktopPage />;
 */
export function ResponsiveShell({
  desktop,
  mobile,
  children,
}: ResponsiveShellProps) {
  const { isMobile } = useUIModeOptional();

  if (isMobile) {
    return <MobileShell {...mobile}>{children}</MobileShell>;
  }

  return <DesktopShell {...desktop}>{children}</DesktopShell>;
}
