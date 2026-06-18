'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * URL-state helper for section pages that use query params for selection +
 * filters (e.g. /settings/access?staffId=, /admin?section=logs&eventId=).
 */
export function useScopedUrlState(basePath: string) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      const qs = next.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath);
    },
    [router, searchParams, basePath],
  );

  return { searchParams, setParam };
}
