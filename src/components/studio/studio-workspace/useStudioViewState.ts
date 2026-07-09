'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { StudioLens, StudioZoom } from '../studio-types';

interface StudioViewState {
  /** Whether the user is currently on the /studio route (provider is active). */
  active: boolean;
  v: string | null;
  focus: string | null;
  /** URL-derived zoom; the provider demotes it to L1 while editing. */
  zParam: StudioZoom;
  lens: StudioLens;
  setParams: (patch: Record<string, string | null>) => void;
}

/** URL-derived view state (`?v=&focus=&z=&lens=`) plus the `setParams` writer. */
export function useStudioViewState(): StudioViewState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active = !!pathname && (pathname === '/studio' || pathname.startsWith('/studio/'));

  const v = searchParams.get('v');
  const focus = searchParams.get('focus');
  const zRaw = searchParams.get('z');
  const zParam: StudioZoom = zRaw === '0' ? 0 : zRaw === '2' ? 2 : 1;
  const lensRaw = searchParams.get('lens');
  const lens: StudioLens =
    lensRaw === 'live' ||
    lensRaw === 'gaps' ||
    lensRaw === 'static' ||
    lensRaw === 'flow' ||
    lensRaw === 'people'
      ? lensRaw
      : 'build';

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      // Seed from the current query string only when already on /studio —
      // hard-routing in from another page (assistant canvas tools) must not
      // drag that page's params (?mode=, ?q=, …) into the Studio URL.
      const next = new URLSearchParams(active ? searchParams.toString() : '');
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `/studio?${qs}` : '/studio', { scroll: false });
    },
    [router, searchParams, active],
  );

  return { active, v, focus, zParam, lens, setParams };
}
