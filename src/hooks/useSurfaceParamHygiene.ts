'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { stripCrossSurfaceParams } from '@/lib/surface-isolation';

/**
 * On mount / navigation, drop URL params that belong to the other surface
 * family (Receiving `?mode=` vs Testing `?view=`). Prevents deep-links and
 * back-button history from carrying testing state into Unbox/Receiving and
 * vice versa.
 */
export function useSurfaceParamHygiene(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const current = new URLSearchParams(searchParams.toString());
    const cleaned = stripCrossSurfaceParams(pathname, current);
    if (cleaned.toString() === current.toString()) return;
    const qs = cleaned.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, searchParams, router]);
}
