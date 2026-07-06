'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { addRecent } from './storage';
import {
  resolveQuickAccessHref,
  resolveQuickAccessLabelFromLocation,
} from './page-label';

const STORAGE_EVENT_KEY = 'usav.quickAccess.changed';

/**
 * Records page visits for the Quick Access "Recent" list. Mount once in the
 * app shell — keeps recents labels in sync with route metadata.
 */
export function QuickAccessVisitRecorder() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || !pathname) return;
    const href = resolveQuickAccessHref(pathname, searchParams);
    if (!href || href.startsWith('/signin')) return;

    const label = resolveQuickAccessLabelFromLocation(
      pathname,
      searchParams,
      user.organizationName,
    );
    addRecent({ href, label, visitedAt: Date.now() });
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT_KEY));
  }, [pathname, searchParams, user]);

  return null;
}
