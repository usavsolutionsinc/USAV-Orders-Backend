'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { PODetail } from './audit-receiving-types';

/**
 * Loads the full audit detail (PO + cartons + lines + events) for the `?po=`
 * URL param. Race-guarded — a stale in-flight response is dropped when `po`
 * changes. Returns null detail when no PO is selected.
 */
export function usePoAuditDetail() {
  const searchParams = useSearchParams();
  const selectedPo = searchParams.get('po');
  const [detail, setDetail] = useState<PODetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPo) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    setError(null);
    fetch(`/api/audit-log/receiving?po=${encodeURIComponent(selectedPo)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as PODetail);
        else setError(d?.error ?? 'Failed to load PO detail');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedPo]);

  return { selectedPo, detail, detailLoading, error };
}
