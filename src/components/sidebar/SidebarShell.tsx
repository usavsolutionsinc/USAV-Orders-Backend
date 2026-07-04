'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { MasterNav, MasterNavProvider } from '@/components/sidebar/master-nav';
import { SidebarContextPanel } from '@/components/sidebar/SidebarContextPanel';

// Pages that use the master-nav L2 ModeRail (flush segmented). Panels for these
// ids gate their own pill-row on useMasterNavEnabled() so the switcher is not
// doubled. Keep this set in sync with those gated panels.
const MASTER_NAV_RAIL_PAGES: ReadonlySet<string> = new Set([
  'dashboard',
  'operations',
  'receiving',
  'fba',
  'inventory',
  'warehouse',
  'products',
  'walk-in',
  'tech',
  'sourcing',
  'outbound',
  'packer',
  'support',
]);

export interface SidebarShellProps {
  /** Permission set used to filter the nav, or `undefined` to render unfiltered. */
  permissions: Set<string> | undefined;
  /** Restrict the nav for mobile devices. */
  mobileRestricted: boolean;
  /** Called when the user navigates (e.g. to close a drawer). */
  onNavigate?: () => void;
  /** Inset the top for the mobile drawer notch / status bar. */
  inDrawer?: boolean;
}

/**
 * The single master sidebar nav — one dropdown (recents on top, current page
 * hidden, grouped Main / Stations / More) plus the per-page L2 mode rail. The
 * `MasterNavProvider` tells panels rendered in `renderContext` to hide their
 * own mode pills (the rail is the single switcher).
 *
 * See docs/design-system/master-sidebar-nav-migration-plan.md.
 */
export function SidebarShell({
  permissions,
  mobileRestricted,
  onNavigate,
  inDrawer = false,
}: SidebarShellProps) {
  return (
    <aside
      className={`h-full w-full bg-surface-card border-r border-border-default overflow-hidden shadow-xl shadow-gray-900/5 flex flex-col ${
        // In the mobile drawer, inset the top so the header clears the notch /
        // status bar (parity with the old drawer trigger).
        inDrawer ? 'pt-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))]' : ''
      }`}
    >
      <MasterNavProvider enabled>
        <MasterNav
          permissions={permissions}
          mobileRestricted={mobileRestricted}
          railPageIds={MASTER_NAV_RAIL_PAGES}
          onNavigate={onNavigate}
          renderContext={() => <SidebarContextPanel />}
          className="flex-1 min-h-0"
        />
      </MasterNavProvider>
    </aside>
  );
}

export interface MobileSidebarOverlayProps {
  onClose: () => void;
  children: ReactNode;
}

/**
 * Full-screen mobile drawer overlay: a tap-to-dismiss backdrop, the sidebar
 * shell, and an explicit close button.
 */
export function MobileSidebarOverlay({ onClose, children }: MobileSidebarOverlayProps) {
  return (
    <div className="md:hidden fixed inset-0 z-panel">
      <button
        type="button"
        className="ds-raw-button absolute inset-0 bg-gray-900/35"
        onClick={onClose}
        aria-label="Close sidebar overlay"
      />
      <div className="relative h-full max-w-[94vw]">{children}</div>
      <IconButton
        onClick={onClose}
        ariaLabel="Close sidebar"
        icon={<X className="h-5 w-5" />}
        className="absolute top-4 right-4 h-11 w-11 rounded-2xl bg-surface-card border border-border-emphasis text-text-muted shadow-lg shadow-gray-900/10 flex items-center justify-center"
      />
    </div>
  );
}
