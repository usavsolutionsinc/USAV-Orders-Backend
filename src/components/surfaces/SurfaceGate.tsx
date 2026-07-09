'use client';

/**
 * SurfaceGate — decides at render time whether an operator surface shows its
 * data-driven composition (SurfaceRenderer) or its hard-coded legacy tree
 * (`children`). Queries `/api/surfaces/:key/resolve`, which returns
 * `render:'composed'` only when an active `station_definitions` composition
 * exists AND the per-org `surface_composed_render` flag is on.
 *
 * Legacy is the safe default: while loading, on error, or when the flag/
 * composition is absent, `children` (the proven legacy tree) renders unchanged.
 * Wrapping a page in this gate is therefore a no-op until an org opts in.
 */

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SurfaceRenderer } from './SurfaceRenderer';
import type { SurfaceKey } from '@/lib/stations/surface-keys';

interface SurfaceResolveResp {
  success?: boolean;
  render?: 'legacy' | 'composed';
}

export function surfaceResolveQuery(surfaceKey: SurfaceKey) {
  return {
    queryKey: ['surface-resolve', surfaceKey] as const,
    queryFn: async (): Promise<SurfaceResolveResp> => {
      try {
        const res = await fetch(`/api/surfaces/${surfaceKey}/resolve`, { cache: 'no-store' });
        if (!res.ok) return { render: 'legacy' as const };
        return (await res.json()) as SurfaceResolveResp;
      } catch {
        return { render: 'legacy' as const };
      }
    },
    // Composition changes on publish; a long staleTime + no refetch loop.
    staleTime: 5 * 60_000,
  };
}

export function SurfaceGate({
  surfaceKey,
  children,
}: {
  surfaceKey: SurfaceKey;
  children: ReactNode;
}) {
  const { data } = useQuery(surfaceResolveQuery(surfaceKey));
  if (data?.render === 'composed') return <SurfaceRenderer surfaceKey={surfaceKey} />;
  return <>{children}</>;
}
