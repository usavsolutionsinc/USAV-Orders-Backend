'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { warrantyClaimsQuery } from '@/lib/queries/dashboard-queries';
import { fetchWarrantyClaim } from '@/lib/warranty/client';
import { isWarrantyClaimStatus, type WarrantyClaimStatus } from '@/lib/warranty/types';

/** Default look-ahead window (days) for the "Expiring soon" filter. */
export const WARRANTY_EXPIRING_SOON_DAYS = 7;

export interface WarrantyUrlState {
  status: WarrantyClaimStatus | null;
  expiringSoon: boolean;
  openClaimId: number | null;
  setStatus: (next: WarrantyClaimStatus | null) => void;
  setExpiringSoon: (next: boolean) => void;
  openClaim: (id: number | null) => void;
}

/**
 * URL-state for the Warranty Logger mode: `?wstatus`, `?wexp`, `?open`. All mode
 * state lives in the URL (sidebar-mode contract); switching modes clears these
 * via normalizeDashboardOrderViewParams.
 */
export function useWarrantyUrlState(): WarrantyUrlState {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const statusParam = searchParams.get('wstatus');
  const status = isWarrantyClaimStatus(statusParam) ? statusParam : null;
  const expiringSoon = searchParams.get('wexp') === '1';
  const openRaw = Number(searchParams.get('open'));
  const openClaimId = Number.isFinite(openRaw) && openRaw > 0 ? openRaw : null;

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard', { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setStatus = useCallback(
    (next: WarrantyClaimStatus | null) =>
      update((params) => {
        if (next) params.set('wstatus', next);
        else params.delete('wstatus');
        params.delete('open');
      }),
    [update],
  );

  const setExpiringSoon = useCallback(
    (next: boolean) =>
      update((params) => {
        if (next) params.set('wexp', '1');
        else params.delete('wexp');
        params.delete('open');
      }),
    [update],
  );

  const openClaim = useCallback(
    (id: number | null) =>
      update((params) => {
        if (id) params.set('open', String(id));
        else params.delete('open');
      }),
    [update],
  );

  return { status, expiringSoon, openClaimId, setStatus, setExpiringSoon, openClaim };
}

export interface UseWarrantyClaimsParams {
  status?: WarrantyClaimStatus | null;
  search?: string;
  expiringSoon?: boolean;
}

/** Claim list — shared cache key with the sidebar + right-pane table. */
export function useWarrantyClaims(params: UseWarrantyClaimsParams = {}) {
  const queryParams = useMemo(
    () => ({
      status: params.status ?? null,
      search: params.search ?? '',
      expiringWithinDays: params.expiringSoon ? WARRANTY_EXPIRING_SOON_DAYS : null,
    }),
    [params.status, params.search, params.expiringSoon],
  );
  return useQuery({
    ...warrantyClaimsQuery(queryParams),
    placeholderData: (prev) => prev,
  });
}

/** Single claim detail (right-pane detail panel). */
export function useWarrantyClaim(id: number | null) {
  return useQuery({
    queryKey: ['warranty-claim', id],
    queryFn: () => (id ? fetchWarrantyClaim(id) : Promise.resolve(null)),
    enabled: id != null,
    staleTime: 30_000,
  });
}
