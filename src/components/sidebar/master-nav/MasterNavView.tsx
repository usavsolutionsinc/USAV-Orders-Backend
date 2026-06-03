'use client';

import type { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { SidebarPageNav } from '@/lib/sidebar-navigation';
import { cn } from '@/utils/_cn';
import { MasterNavHeader } from './MasterNavHeader';
import { MasterNavDropdown } from './MasterNavDropdown';
import { ModeRail } from './ModeRail';

/**
 * Presentational composite of the master nav — header trigger + a floating
 * dropdown + the L2 mode rail. Fully state-driven so it wires to either local
 * state (the /design-demo showroom) or the live router (the {@link MasterNav}
 * container).
 *
 * The dropdown is a true OVERLAY: it's anchored in the header band and floats
 * over the workspace body below (it never takes the whole panel over). The body
 * is supplied via `renderContext` (the sidebar) or omitted (the showroom card).
 * Because the menu stays within the panel's width/height, an `overflow-hidden`
 * host doesn't clip it.
 */
export function MasterNavView({
  activePage,
  activeModeId,
  open,
  onToggleOpen,
  recentPages,
  otherPages,
  expandedKey,
  onToggleRow,
  onNavigate,
  showModeRail = true,
  renderContext,
  className,
}: {
  activePage: SidebarPageNav;
  activeModeId: string | null;
  open: boolean;
  onToggleOpen: () => void;
  recentPages: SidebarPageNav[];
  otherPages: SidebarPageNav[];
  expandedKey: string | null;
  onToggleRow: (key: string | null) => void;
  onNavigate: (pageId: string, modeId?: string) => void;
  showModeRail?: boolean;
  /** The workspace body shown under the rail; the dropdown floats over it. */
  renderContext?: () => ReactNode;
  className?: string;
}) {
  const activeMode = activePage.modes?.find((m) => m.id === activeModeId);
  // Icon = page context; label = active mode (or page name when modeless).
  const headerLabel = activeMode?.label ?? activePage.label;

  const rail =
    showModeRail && activePage.modes && activePage.modes.length > 1 ? (
      <ModeRail
        modes={activePage.modes}
        activeModeId={activeModeId ?? activePage.modes[0].id}
        onSelect={(modeId) => onNavigate(activePage.id, modeId)}
      />
    ) : null;

  return (
    <div className={cn('relative flex min-h-0 flex-col', renderContext && 'h-full', className)}>
      {/* Header band — its own stacking context anchors the floating menu. */}
      <div className="relative z-20 shrink-0 border-b border-border-soft">
        <MasterNavHeader icon={activePage.icon} label={headerLabel} open={open} onToggle={onToggleOpen} />
        <AnimatePresence>
          {open && (
            <MasterNavDropdown
              recentPages={recentPages}
              otherPages={otherPages}
              expandedKey={expandedKey}
              onToggleRow={onToggleRow}
              onNavigate={onNavigate}
              className="absolute inset-x-1 top-[calc(100%-1px)]"
            />
          )}
        </AnimatePresence>
      </div>
      {rail}
      {renderContext && <div className="min-h-0 flex-1 overflow-hidden">{renderContext()}</div>}
    </div>
  );
}
