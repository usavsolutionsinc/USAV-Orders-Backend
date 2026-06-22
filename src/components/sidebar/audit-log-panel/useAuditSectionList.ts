'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/** Shared filter params (day/start/end/staffId) serialized for a section fetch. */
export function useSharedFilterQS(): string {
  const sp = useSearchParams();
  return useMemo(() => {
    const next = new URLSearchParams();
    for (const k of ['day', 'start', 'end', 'staffId']) {
      const v = sp.get(k);
      if (v) next.set(k, v);
    }
    return next.toString();
  }, [sp]);
}

/**
 * Generic section-list fetch: pulls `/api/audit-log/<section>` with the shared
 * filter QS + the live search query (debounce-free; the caller's `query` is
 * already the section search box). Identical across packing/tech/sku — the only
 * differences are the endpoint, error copy, and row mapping (caller-supplied).
 */
export function useAuditSectionList<T>(
  endpoint: string,
  query: string,
  errorMsg: string,
): { rows: T[]; loading: boolean; error: string | null } {
  const sharedQS = useSharedFilterQS();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = new URL(endpoint, window.location.origin);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', '50');
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setRows(d.items ?? []);
        else setError(d?.error ?? errorMsg);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sharedQS, query, endpoint, errorMsg]);

  return { rows, loading, error };
}
