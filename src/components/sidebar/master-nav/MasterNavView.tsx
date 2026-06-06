'use client';

import { useEffect, useRef, type ReactNode } from 'react';
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
  onRequestClose,
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
  /** Dismiss the open menu (click-outside / Escape). */
  onRequestClose?: () => void;
  showModeRail?: boolean;
  /** The workspace body shown under the rail; the dropdown floats over it. */
  renderContext?: () => ReactNode;
  className?: string;
}) {
  const activeMode = activePage.modes?.find((m) => m.id === activeModeId);
  // Icon = page context; label = active mode (or page name when modeless).
  const headerLabel = activeMode?.label ?? activePage.label;

  // Dismiss on click-outside / Escape. The header + menu are excluded so the
  // header toggle and item clicks keep working; anything else closes it.
  const headerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !onRequestClose) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || headerRef.current?.contains(t)) return;
      onRequestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onRequestClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
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
    <MasterNavDropdown
      ref={menuRef}
      activePage={activePage}
      activeModeId={activeModeId}
      recentPages={recentPages}
      otherPages={otherPages}
      expandedKey={expandedKey}
      onToggleRow={onToggleRow}
      onNavigate={onNavigate}
      // Anchored just below the 40px header. As the LAST child of an isolated
      // root (with the body pinned at z-0), this z-50 menu always paints over
      // the rail + context — nothing inside the panel can ghost through it.
      className="absolute inset-x-1 top-[40px] z-50 max-h-[calc(100%-44px)]"
    />
  );

  // With a context body (the sidebar), the dropdown is a sibling AFTER the body
  // so it overlays it. Without one (the demo card), it floats from the header.
  // No header `border-b`: the full-width line clashed with the dropdown's
  // rounded border at the edges; the rail/panel bands own the separators.
  if (renderContext) {
    return (
      <div className={cn('relative isolate flex h-full min-h-0 flex-col', className)}>
        {/* Interior bottom hairline (inset shadow, not an outer border) — the
            same one the workspace/global header uses, so it lines up. Hidden
            while open so it doesn't double with the dropdown's own border. */}
        <div ref={headerRef} className={cn('shrink-0', !open && receivingHeaderHairlineClass)}>
          <MasterNavHeader
            icon={activeMode?.icon ?? activePage.icon}
            label={headerLabel}
            open={open}
            onToggle={onToggleOpen}
          />
        </div>
        {rail}
        <div className="relative z-0 min-h-0 flex-1 overflow-hidden">{renderContext()}</div>
        <AnimatePresence>{open && dropdown}</AnimatePresence>
      </div>
    );
  }

  return (
    <div className={cn('relative flex min-h-0 flex-col', className)}>
      <div ref={headerRef} className={cn('relative z-30 shrink-0', !open && receivingHeaderHairlineClass)}>
        <MasterNavHeader
          icon={activeMode?.icon ?? activePage.icon}
          label={headerLabel}
          open={open}
          onToggle={onToggleOpen}
        />
        <AnimatePresence>
          {open && (
            <MasterNavDropdown
              ref={menuRef}
              activePage={activePage}
              activeModeId={activeModeId}
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
    </div>
  );
}
