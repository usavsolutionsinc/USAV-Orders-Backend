'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  OUTBOUND_MODE_SCOPED_PARAMS,
  OUTBOUND_PATH,
  parseOutboundMode,
  parseOutboundSort,
  type OutboundMode,
  type OutboundSort,
} from '@/components/outbound/outbound-sidebar-shared';

export function useOutboundUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode = useMemo(
    () => parseOutboundMode(searchParams.get('mode')),
    [searchParams],
  );
  const q = useMemo(() => String(searchParams.get('q') || '').trim(), [searchParams]);
  const open = useMemo(() => {
    const raw = searchParams.get('open');
    if (!raw || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  }, [searchParams]);
  const sort = useMemo(
    () => parseOutboundSort(searchParams.get('sort')),
    [searchParams],
  );

  const basePath = pathname?.startsWith(OUTBOUND_PATH) ? OUTBOUND_PATH : pathname || OUTBOUND_PATH;

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      if (params.get('mode') === 'labels') params.delete('mode');
      const qs = params.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    },
    [basePath, router, searchParams],
  );

  const updateMode = useCallback(
    (next: OutboundMode) => {
      replaceParams((params) => {
        for (const key of OUTBOUND_MODE_SCOPED_PARAMS) params.delete(key);
        if (next === 'scan-out') params.set('mode', 'scan-out');
        else params.delete('mode');
      });
    },
    [replaceParams],
  );

  const setQ = useCallback(
    (value: string) => {
      replaceParams((params) => {
        const trimmed = value.trim();
        if (trimmed) params.set('q', trimmed);
        else params.delete('q');
      });
    },
    [replaceParams],
  );

  const setOpen = useCallback(
    (orderId: number | null) => {
      replaceParams((params) => {
        if (orderId != null && orderId > 0) params.set('open', String(orderId));
        else params.delete('open');
      });
    },
    [replaceParams],
  );

  const setSort = useCallback(
    (next: OutboundSort) => {
      replaceParams((params) => {
        if (next === 'newest') params.set('sort', 'newest');
        else params.delete('sort');
      });
    },
    [replaceParams],
  );

  return {
    mode,
    q,
    open,
    sort,
    updateMode,
    setQ,
    setOpen,
    setSort,
  };
}
