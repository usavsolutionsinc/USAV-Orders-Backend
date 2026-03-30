'use client';

import { type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DesktopShellProps {
  /** Left sidebar content (navigation, context panels). */
  sidebar?: ReactNode;
  /** Width of the sidebar. Default 360px (matches existing DashboardSidebar). */
  sidebarWidth?: number | string;
  /** Whether the sidebar is collapsed (e.g., when viewing details). */
  sidebarCollapsed?: boolean;
  /** Main content area. */
  children: ReactNode;
  /** Optional top bar / header. */
  topBar?: ReactNode;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * DesktopShell — the root layout frame for desktop mode.
 *
 * Structure:
 *   ┌───────────┬──────────────────────────────┐
 *   │           │ Top bar (optional)            │
 *   │  Sidebar  ├──────────────────────────────┤
 *   │  (360px)  │                              │
 *   │           │  Main content (flex-1)       │
 *   │           │                              │
 *   └───────────┴──────────────────────────────┘
 *
 * This mirrors your existing layout.tsx structure but as a
 * composable design-system component.
 *
 * Sidebar collapses with a width transition (matches DashboardSidebar behavior).
 */
export function DesktopShell({
  sidebar,
  sidebarWidth = 360,
  sidebarCollapsed = false,
  children,
  topBar,
  className = '',
}: DesktopShellProps) {
  const resolvedWidth = typeof sidebarWidth === 'number' ? `${sidebarWidth}px` : sidebarWidth;

  return (
    <div className={`flex h-screen overflow-hidden bg-white ${className}`.trim()}>
      {/* ── Sidebar ── */}
      {sidebar && (
        <div
          className="flex-shrink-0 h-full overflow-hidden transition-[width] duration-300"
          style={{ width: sidebarCollapsed ? 0 : resolvedWidth }}
        >
          {sidebar}
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {topBar && (
          <div className="flex-shrink-0">{topBar}</div>
        )}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
