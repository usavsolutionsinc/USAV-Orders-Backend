'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { SidebarPageNav } from '@/lib/sidebar-navigation';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';
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
 * The dropdown opens on click (the header toggles it) and closes on a click
 * outside the header/menu or Escape. It floats over the workspace body below
 * (it never takes the whole panel over). The body is supplied via
 * `renderContext` (the sidebar) or omitted (the showroom card). Because the menu
 * stays within the panel's width/height, an `overflow-hidden` host doesn't clip it.
 */
export function MasterNavView({
  activePage,
  activeModeId,
  open,
  onOpen,
  recentPages,
  otherPages,
  expandedKey,
  onToggleRow,
  onNavigate,
  onRequestClose,
  showModeRail = true,
  renderContext,
  className,
}: {
  activePage: SidebarPageNav;
  activeModeId: string | null;
  open: boolean;
  onOpen: () => void;
  recentPages: SidebarPageNav[];
  otherPages: SidebarPageNav[];
  expandedKey: string | null;
  onToggleRow: (key: string | null) => void;
  onNavigate: (pageId: string, modeId?: string) => void;
  /** Dismiss the open menu (mouse leave / Escape). */
  onRequestClose?: () => void;
  showModeRail?: boolean;
  /** The workspace body shown under the rail; the dropdown floats over it. */
  renderContext?: () => ReactNode;
  className?: string;
}) {
  const activeMode = activePage.modes?.find((m) => m.id === activeModeId);
  const headerLabel = activeMode?.label ?? activePage.label;

  const handleToggle = useCallback(() => {
    if (open) onRequestClose?.();
    else onOpen();
  }, [open, onOpen, onRequestClose]);

  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside the header trigger and the open menu.
  useEffect(() => {
    if (!open || !onRequestClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (headerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onRequestClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onRequestClose]);

  const rail =
    showModeRail && activePage.modes && activePage.modes.length > 1 ? (
      <ModeRail
        modes={activePage.modes}
        activeModeId={activeModeId ?? activePage.modes[0].id}
        onSelect={(modeId) => onNavigate(activePage.id, modeId)}
      />
    ) : null;

  const dropdown = (
    <div className="absolute inset-x-1 top-[40px] bottom-1 z-dropdown">
      <MasterNavDropdown
        ref={menuRef}
        activePage={activePage}
        activeModeId={activeModeId}
        recentPages={recentPages}
        otherPages={otherPages}
        expandedKey={expandedKey}
        onToggleRow={onToggleRow}
        onNavigate={onNavigate}
        className="max-h-full"
      />
    </div>
  );

  // With a context body (the sidebar), the dropdown lives in the header band and
  // floats over the rail + body below. Without one (the demo card), it floats
  // from the header. No header `border-b`: the full-width line clashed with the
  // dropdown's rounded border at the edges; the rail/panel bands own the separators.
  if (renderContext) {
    return (
      <div className={cn('relative isolate flex h-full min-h-0 flex-col', className)}>
        {/* Interior bottom hairline (inset shadow, not an outer border) — the
            same one the workspace/global header uses, so it lines up. Hidden
            while open so it doesn't double with the dropdown's own border. */}
        <div
          ref={headerRef}
          className={cn('relative z-20 shrink-0', !open && receivingHeaderHairlineClass)}
        >
          <MasterNavHeader
            icon={activeMode?.icon ?? activePage.icon}
            label={headerLabel}
            open={open}
            onClick={handleToggle}
          />
        </div>
        {rail}
        <div className="relative z-0 min-h-0 flex-1 overflow-hidden">{renderContext()}</div>
        {/* Dropdown floats over the whole panel — anchored to the root (not the
            ~40px header band) so its definite top/bottom give the inner menu a
            height to scroll within. */}
        <AnimatePresence>{open && dropdown}</AnimatePresence>
      </div>
    );
  }

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div className={cn('relative z-30 shrink-0', !open && receivingHeaderHairlineClass)}>
        <div ref={headerRef}>
          <MasterNavHeader
            icon={activeMode?.icon ?? activePage.icon}
            label={headerLabel}
            open={open}
            onClick={handleToggle}
          />
        </div>
        <AnimatePresence>
          {open && (
            <div className="absolute inset-x-1 top-[calc(100%-1px)]">
              <MasterNavDropdown
                ref={menuRef}
                activePage={activePage}
                activeModeId={activeModeId}
                recentPages={recentPages}
                otherPages={otherPages}
                expandedKey={expandedKey}
                onToggleRow={onToggleRow}
                onNavigate={onNavigate}
              />
            </div>
          )}
        </AnimatePresence>
      </div>
      {rail}
    </div>
  );
}
