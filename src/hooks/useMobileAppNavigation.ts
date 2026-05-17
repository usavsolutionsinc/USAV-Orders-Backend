'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getSidebarRouteKey } from '@/lib/sidebar-navigation';
import {
  getMobileAppTitle,
  getMobileContextRowConfig,
  routeHasMobileContextRow,
  type MobileContextRowConfig,
} from '@/lib/mobile-context-navigation';

export type MobileContextNavPhase = 'browse' | 'detail';

export interface UseMobileAppNavigationResult {
  appTitle: string;
  routeKey: ReturnType<typeof getSidebarRouteKey>;
  contextRow: MobileContextRowConfig | null;
  showContextRow: boolean;
  contextPhase: MobileContextNavPhase;
  enterContextDetail: () => void;
  backToContextBrowse: () => void;
  navigateTo: (href: string) => void;
}

export function useMobileAppNavigation(): UseMobileAppNavigationResult {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoaded, has } = useAuth();
  const [contextPhase, setContextPhase] = useState<MobileContextNavPhase>('browse');

  const routeKey = getSidebarRouteKey(pathname);
  const appTitle = getMobileAppTitle(pathname);

  const navigateTo = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  const contextRow = useMemo(
    () =>
      routeHasMobileContextRow(routeKey)
        ? getMobileContextRowConfig(
            routeKey,
            searchParams,
            navigateTo,
            has,
            isLoaded,
            Boolean(user),
          )
        : null,
    [routeKey, searchParams, navigateTo, has, isLoaded, user],
  );

  useEffect(() => {
    setContextPhase('browse');
  }, [routeKey]);

  const enterContextDetail = useCallback(() => {
    setContextPhase('detail');
  }, []);

  const backToContextBrowse = useCallback(() => {
    setContextPhase('browse');
  }, []);

  return {
    appTitle,
    routeKey,
    contextRow,
    showContextRow: contextRow != null,
    contextPhase,
    enterContextDetail,
    backToContextBrowse,
    navigateTo,
  };
}
