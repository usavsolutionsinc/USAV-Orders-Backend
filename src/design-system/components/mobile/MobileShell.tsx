'use client';

import { type ReactNode } from 'react';
import { cn } from '@/utils/_cn';
import { MobileNavBar, type MobileNavItem } from './MobileNavBar';
import { MobileToolbar } from './MobileToolbar';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileShellToolbarConfig = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export interface MobileShellProps {
  /** Top toolbar config — omit or pass `false` when a parent supplies the header (camera, onboarding, unified tech bar). */
  toolbar?: MobileShellToolbarConfig | false;
  /** Bottom navigation items. Omit to hide bottom nav (e.g., during camera scan). */
  navItems?: MobileNavItem[];
  /** Active bottom nav tab ID. */
  activeNavId?: string;
  /** Nav tab change handler. */
  onNavigate?: (id: string) => void;
  /** Main scrollable content area. */
  children: ReactNode;
  /** Slot for floating action button — rendered above bottom nav. */
  fab?: ReactNode;
  /** Slot for bottom-docked controls (scan bar, confirm button). Sits above nav. */
  bottomDock?: ReactNode;
  /**
   * `inset` — dock is a normal flex footer (white strip). `overlay` — dock is fixed to the bottom
   * with no shell chrome so content can scroll beneath (use with {@link MobileBottomActionBar} `chrome="ghost"`).
   */
  bottomDockVariant?: 'inset' | 'overlay';
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileShell — the root layout frame for mobile mode.
 *
 * Structure (top to bottom):
 *   ┌──────────────────────────────────┐
 *   │ MobileToolbar (safe-area-top)    │  ← optional
 *   ├──────────────────────────────────┤
 *   │                                  │
 *   │  Scrollable content (flex-1)     │
 *   │                                  │
 *   ├──────────────────────────────────┤
 *   │ Bottom dock (scan bar, etc.)     │  ← optional
 *   ├──────────────────────────────────┤
 *   │ MobileNavBar (safe-area-bottom)  │  ← optional
 *   └──────────────────────────────────┘
 *   │ FAB (absolute, above nav)        │  ← optional
 *
 * Design rules:
 *   - Full viewport height via `h-[100dvh]` (dynamic viewport height)
 *   - Content scrolls independently; toolbar and nav stay fixed
 *   - `100dvh` accounts for mobile browser chrome (Safari URL bar)
 *   - No horizontal overflow — all content is constrained
 *   - Bottom dock sits between content and nav (for scan bars, confirm buttons)
 */
export function MobileShell({
  toolbar,
  navItems,
  activeNavId = '',
  onNavigate,
  children,
  fab,
  bottomDock,
  bottomDockVariant = 'inset',
  className = '',
}: MobileShellProps) {
  const dockOverlay = bottomDockVariant === 'overlay';

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-white h-[100dvh]',
        className,
      )}
    >
      {/* ── Top toolbar ── */}
      {toolbar && (
        <MobileToolbar
          title={toolbar.title}
          subtitle={toolbar.subtitle}
          leading={toolbar.leading}
          trailing={toolbar.trailing}
        />
      )}

      {/* ── Scrollable content — min-h-0 required for flex + overflow inside nested layouts (e.g. mobile tech header). */}
      <main
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar',
          dockOverlay &&
            'pb-[calc(5.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        {children}
      </main>

      {/* ── Bottom dock (scan bar, action bar) ── */}
      {bottomDock && (
        dockOverlay ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
            <div className="pointer-events-auto">{bottomDock}</div>
          </div>
        ) : (
          <div className="flex-shrink-0 border-t border-gray-100 bg-white">
            {bottomDock}
          </div>
        )
      )}

      {/* ── Bottom navigation ── */}
      {navItems && navItems.length > 0 && onNavigate && (
        <MobileNavBar
          items={navItems}
          activeId={activeNavId}
          onNavigate={onNavigate}
        />
      )}

      {/* ── FAB (positioned above nav via its own fixed/absolute styles) ── */}
      {fab}
    </div>
  );
}
