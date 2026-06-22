'use client';

import { useUIMode } from '@/design-system/providers/UIModeProvider';
import { MobileSidebarOverlay, SidebarShell } from '@/components/sidebar/SidebarShell';
import {
  useAuthPermissions,
  useMobileSidebar,
  useStationDetailsPanel,
} from '@/components/sidebar/dashboard-sidebar-hooks';

export interface DashboardSidebarProps {
  /** Rendered inside ResponsiveLayout's mobile drawer (it owns positioning + backdrop). */
  inDrawer?: boolean;
  /** Called when the user navigates from within the sidebar. */
  onNavigate?: () => void;
}

/**
 * Thin composition layer for the app's master sidebar. State + side effects
 * live in `dashboard-sidebar-hooks`; the chrome lives in `SidebarShell` /
 * `MobileSidebarOverlay`; the per-route panel lives in `SidebarContextPanel`.
 */
export default function DashboardSidebar({ inDrawer = false, onNavigate }: DashboardSidebarProps) {
  const { isMobile } = useUIMode();
  const permissions = useAuthPermissions();
  const mobile = useMobileSidebar();
  // Closing a details overlay should dismiss the mobile drawer.
  useStationDetailsPanel(mobile.close);

  const shell = (
    <SidebarShell
      permissions={permissions}
      mobileRestricted={isMobile}
      onNavigate={onNavigate}
      inDrawer={inDrawer}
    />
  );

  // When rendered inside ResponsiveLayout's mobile drawer, render the shell
  // directly — the drawer handles positioning, backdrop, and close.
  if (inDrawer) return shell;

  return (
    <>
      {/* Docked desktop sidebar. The details panel is a fixed overlay, so the
          sidebar never collapses for it — width stays fixed. */}
      <div className="hidden md:block h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 w-[360px]">
        {shell}
      </div>

      {/* Floating mobile menu button removed — now handled by header nav buttons */}

      {mobile.canShow && mobile.isOpen && (
        <MobileSidebarOverlay onClose={mobile.close}>{shell}</MobileSidebarOverlay>
      )}
    </>
  );
}
