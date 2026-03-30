'use client';

import { type ReactNode } from 'react';
import { MobileNavBar, type MobileNavItem } from './MobileNavBar';
import { MobileToolbar } from './MobileToolbar';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MobileShellProps {
  /** Top toolbar config — omit for full-screen flows (camera, onboarding). */
  toolbar?: {
    title: string;
    subtitle?: string;
    leading?: ReactNode;
    trailing?: ReactNode;
  };
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
  className = '',
}: MobileShellProps) {
  return (
    <div className={`flex flex-col h-[100dvh] bg-white overflow-hidden ${className}`.trim()}>
      {/* ── Top toolbar ── */}
      {toolbar && (
        <MobileToolbar
          title={toolbar.title}
          subtitle={toolbar.subtitle}
          leading={toolbar.leading}
          trailing={toolbar.trailing}
        />
      )}

      {/* ── Scrollable content ── */}
      <main className="flex-1 overflow-y-auto overscroll-contain no-scrollbar">
        {children}
      </main>

      {/* ── Bottom dock (scan bar, action bar) ── */}
      {bottomDock && (
        <div className="flex-shrink-0 border-t border-gray-100 bg-white">
          {bottomDock}
        </div>
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
