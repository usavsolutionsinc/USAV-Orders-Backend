'use client';

import { usePathname } from 'next/navigation';
import { Menu } from '@/components/Icons';
import { useHeader } from '@/contexts/HeaderContext';
import { useAuth } from '@/contexts/AuthContext';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
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
export function GlobalHeader() {
  const pathname = usePathname();
  const { panelContent } = useHeader();
  const { user } = useAuth();
  // /operations hides the desktop sidebar, so the drawer hamburger is the only
  // way into the nav there — surface it in the header's left edge.
  const showMenuButton = getSidebarRouteKey(pathname) === 'operations';

  // Public / auth pages (signin, signup, offline) render no app chrome.
  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 flex h-12 w-full shrink-0 select-none items-center gap-3 border-b border-gray-200 bg-white/90 px-3 backdrop-blur-md sm:px-4">
      {showMenuButton && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-drawer'))}
          aria-label="Open navigation"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
        >
          <Menu className="h-4 w-4" />
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
