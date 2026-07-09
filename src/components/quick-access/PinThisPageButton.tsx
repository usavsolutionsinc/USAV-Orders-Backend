'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/design-system/primitives';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
import { useQuickAccess } from '@/lib/quick-access/use-quick-access';
import { useAuth } from '@/contexts/AuthContext';
import {
  resolveQuickAccessHref,
  resolveQuickAccessLabelFromLocation,
} from '@/lib/quick-access/page-label';

interface PinThisPageButtonProps {
  onPinned?: () => void;
}

/**
 * Inline pin affordance in the Pinned section header. Hides when the current
 * URL is already pinned.
 */
export function PinThisPageButton({ onPinned }: PinThisPageButtonProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pin, isHrefPinned } = useQuickAccess();
  const { user } = useAuth();

  const href = resolveQuickAccessHref(pathname, searchParams);
  if (!href) return null;
  if (isHrefPinned(href)) return null;

  const handleClick = () => {
    const label = resolveQuickAccessLabelFromLocation(
      pathname,
      searchParams,
      user?.organizationName,
    );
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
      className="text-caption font-semibold text-blue-600 hover:bg-blue-50"
    >
      Pin page
    </Button>
  );
}
