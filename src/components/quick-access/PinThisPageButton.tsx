'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/design-system/primitives';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import { PRODUCT_NAME } from '@/lib/branding/constants';

interface PinThisPageButtonProps {
  onPinned?: () => void;
}

function currentHref(pathname: string | null, searchParams: URLSearchParams | null): string {
  if (!pathname) return '';
  const search = searchParams?.toString();
  return search ? `${pathname}?${search}` : pathname;
}

// Sentinel titles that are the root layout's fallback document.title (product
// name signed-out, workspace name signed-in) rather than a real per-page
// title — see src/app/layout.tsx. Falling back on those would pin every page
// under the same generic label.
function currentLabel(pathname: string | null, organizationName?: string | null): string {
  if (typeof document !== 'undefined') {
    const title = document.title?.trim();
    if (title && title !== PRODUCT_NAME && title !== organizationName) return title;
  }
  const routeKey = getSidebarRouteKey(pathname);
  if (routeKey && routeKey !== 'unknown') {
    return routeKey.charAt(0).toUpperCase() + routeKey.slice(1).replace(/-/g, ' ');
  }
  return pathname || 'Page';
}

/**
 * Inline "+ Pin page" button used as a section-header affordance. Hides
 * itself when the current URL is already pinned.
 */
export function PinThisPageButton({ onPinned }: PinThisPageButtonProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pin, isHrefPinned } = useQuickAccess();
  const { user } = useAuth();

  const href = currentHref(pathname, searchParams as URLSearchParams | null);
  if (!href) return null;
  if (isHrefPinned(href)) return null;

  const handleClick = () => {
    const label = currentLabel(pathname, user?.organizationName);
    const result = pin({ label, href, iconKey: getSidebarRouteKey(pathname) });
    if (result === 'added') onPinned?.();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleClick}
      icon={
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      }
      className="text-micro font-bold uppercase tracking-widest text-blue-600 hover:bg-blue-50"
    >
      Pin page
    </Button>
  );
}
