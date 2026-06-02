'use client';

import { useHeader } from '@/contexts/HeaderContext';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalHeaderActions } from './GlobalHeaderActions';

/**
 * Global desktop header — one persistent bar mounted once in
 * {@link ResponsiveLayout}, above the page's `<main>`.
 *
 * Two zones:
 *   - **Left / center (contextual):** whatever the active page pushes through
 *     {@link useHeader} / {@link usePageHeader} — title, "Select" toggle,
 *     filters, bulk-action triggers. Empty on pages that don't set it.
 *   - **Right (persistent):** {@link GlobalHeaderActions} — search, notifications,
 *     staff switcher, account. Identical on every page.
 *
 * Mobile keeps its own chrome (MobileAppHeader); this bar is desktop-only.
 */
interface GlobalHeaderProps {
  /** True on routes that render the permanent desktop sidebar (everything but
   *  /operations) — gates the collapse toggle. */
  canCollapseSidebar?: boolean;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function GlobalHeader({
  canCollapseSidebar = false,
  sidebarCollapsed = false,
  onToggleSidebar,
}: GlobalHeaderProps = {}) {
  const { panelContent } = useHeader();
  const { user } = useAuth();

  // Public / auth pages (signin, signup, offline) render no app chrome.
  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 flex h-[40px] w-full shrink-0 select-none items-center gap-3 border-b border-gray-300 bg-white/90 px-3 backdrop-blur-md sm:px-4">
      {/* Top-left sidebar toggle — collapses / restores the permanent sidebar. */}
      {canCollapseSidebar && onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!sidebarCollapsed}
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
      )}

      {/* Contextual zone — fed per page via useHeader()/usePageHeader(). */}
      <div className="flex min-w-0 flex-1 items-center">{panelContent}</div>

      {/* Persistent zone — same on every page. */}
      <GlobalHeaderActions />
    </header>
  );
}

export default GlobalHeader;
