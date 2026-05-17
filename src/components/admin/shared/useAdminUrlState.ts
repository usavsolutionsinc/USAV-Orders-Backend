'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Shared URL-state helper for admin sidebars. Wraps Next's `useSearchParams`
 * with a `setParam(mutator)` that replaces `/admin?...` while keeping the
 * rest of the query intact. All admin sidebars use this to ensure URL state
 * is the single source of truth for selection + filters.
 */
export function useAdminUrlState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      const qs = next.toString();
      router.replace(qs ? `/admin?${qs}` : '/admin');
    },
    [router, searchParams],
  );

  return { searchParams, setParam };
}
