'use client';

/**
 * State + side-effect hooks extracted from the former `DashboardSidebar` God
 * component. Each owns a single responsibility so the sidebar shell and the
 * route-context panels stay thin and presentational.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { unshippedOrdersQuery } from '@/lib/queries/dashboard-queries';
import { useAuth } from '@/contexts/AuthContext';
import { emitAppEvent, useEventBridge } from '@/hooks';
import type { ShippedFormData } from '@/components/shipped';

/**
 * Below this width the mobile drawer is unavailable (the layout shows the
 * docked desktop sidebar instead). Matches the legacy DashboardSidebar value.
 */
export const MOBILE_SIDEBAR_MIN_WIDTH = 420;

/**
 * The signed-in user's permissions as a `Set` for O(1) lookups, or `undefined`
 * while auth is still resolving or the user is signed out. Returning
 * `undefined` (rather than an empty set) lets the nav render unfiltered during
 * the legacy `?staffId=…` rollout flow.
 */
export function useAuthPermissions(): Set<string> | undefined {
  const { user, isLoaded } = useAuth();
  return useMemo<Set<string> | undefined>(() => {
    if (!isLoaded || !user) return undefined;
    return new Set(user.permissions);
  }, [isLoaded, user]);
}

export interface MobileSidebarState {
  /** True when the viewport is in the narrow-but-not-phone band that uses the drawer. */
  canShow: boolean;
  /** Whether the drawer is currently open. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Owns the mobile sidebar drawer: availability (driven by a resize listener)
 * and open/closed state. The drawer auto-closes whenever it becomes
 * unavailable or the route (path or query) changes.
 */
export function useMobileSidebar(): MobileSidebarState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [canShow, setCanShow] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const syncAvailability = () => {
      const nextCanShow =
        window.innerWidth >= MOBILE_SIDEBAR_MIN_WIDTH && window.innerWidth < 768;
      setCanShow(nextCanShow);
      if (!nextCanShow) setIsOpen(false);
    };

    syncAvailability();
    window.addEventListener('resize', syncAvailability);
    return () => window.removeEventListener('resize', syncAvailability);
  }, []);

  // Close the drawer on any navigation — path changes *and* search-param
  // updates (e.g. openOrderId changing during up/down navigation).
  useEffect(() => {
    if (!pathname) return;
    setIsOpen(false);
  }, [pathname, searchParams]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { canShow, isOpen, open, close };
}

/**
 * Wires the cross-pane `open-shipped-details` / `close-shipped-details` window
 * event bridge that sibling tables dispatch, and resets on real route changes.
 *
 * The details panel itself is a fixed overlay rendered elsewhere, so the only
 * observable effect here is `onActivate` (used to close the mobile drawer when
 * a details panel opens). The internal open flag is retained to preserve the
 * legacy reset semantics.
 *
 * @param onActivate Called when a details panel opens (e.g. close the drawer).
 */
export function useStationDetailsPanel(onActivate?: () => void): void {
  const pathname = usePathname();
  const [, setStationDetailsOpen] = useState(false);
  const prevPathnameRef = useRef(pathname);

  // Only reset on actual route changes, not search-param updates.
  useEffect(() => {
    if (!pathname) return;
    if (prevPathnameRef.current !== pathname) {
      setStationDetailsOpen(false);
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  useEventBridge({
    'open-shipped-details': () => {
      setStationDetailsOpen(true);
      onActivate?.();
    },
    'close-shipped-details': () => setStationDetailsOpen(false),
  });
}

/**
 * Unshipped-orders badge count. Reuses the exact query the UnshippedTable /
 * Sidebar mounts, so React Query deduplicates the fetch (no extra request).
 *
 * @param enabled Gate the query (typically `routeKey === 'dashboard'`).
 */
export function useUnshippedCount(enabled = true): number {
  const { data } = useQuery({
    ...unshippedOrdersQuery({ searchQuery: '', strictSearchScope: true }),
    enabled,
  });
  return data?.length ?? 0;
}

/**
 * Returns a submit handler for the shared shipped/order intake form. Routes
 * `add_order` to `/api/orders/add` and everything else to `/api/shipped/submit`,
 * then fires the dashboard/station refresh events on success.
 *
 * @param onSuccess Called after a successful submit (e.g. close the intake form).
 */
export function useShippedFormSubmit(
  onSuccess: () => void,
): (data: ShippedFormData) => Promise<void> {
  return useCallback(
    async (data: ShippedFormData) => {
      try {
        const response =
          data.mode === 'add_order'
            ? await fetch('/api/orders/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId: data.order_id,
                  productTitle: data.product_title,
                  shippingTrackingNumber: data.shipping_tracking_number,
                  sku: data.sku || null,
                  accountSource: 'Manual',
                  condition: data.condition,
                }),
              })
            : await fetch('/api/shipped/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              });

        const result = await response.json();
        if (!result.success) {
          alert(result.error || 'Failed to submit form. Please try again.');
          return;
        }
        onSuccess();
        emitAppEvent('dashboard-refresh');
        emitAppEvent('usav-refresh-data');
      } catch {
        alert('Error submitting form. Please try again.');
      }
    },
    [onSuccess],
  );
}

/** Mutate the current URL's search params. `nextPathname` defaults to the live path. */
export type SidebarSearchMutator = (
  mutate: (params: URLSearchParams) => void,
  nextPathname?: string,
) => void;

/**
 * `pathname`-aware search-param navigator for non-dashboard routes (e.g. admin
 * section deep-links). Unlike the dashboard search controller, this preserves
 * the current path when no explicit target is given.
 */
export function useSidebarSearchNavigation(): SidebarSearchMutator {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return useCallback<SidebarSearchMutator>(
    (mutate, nextPathname) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      mutate(nextParams);
      const targetPath = nextPathname || pathname || '/dashboard';
      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `${targetPath}?${nextSearch}` : targetPath);
    },
    [pathname, router, searchParams],
  );
}
