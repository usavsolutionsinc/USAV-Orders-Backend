'use client';

/**
 * Source-platform read/write for the receiving sidebar's unboxing PO context.
 *
 * Extracted from ReceivingSidebarPanel. `poContext` state stays in the panel
 * (the scan flow + arm/disarm events own it); this hook takes it + its setter
 * and provides the optimistic PATCH plus the cross-surface mirror via the
 * `receiving-package-updated` event. Behaviour is unchanged.
 */

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { emitAppEvent, useEventBridge } from '@/hooks';
import type {
  PoContext,
  ReceivingPackageMeta,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';

interface UseReceivingSourcePlatformArgs {
  poContext: PoContext | null;
  setPoContext: Dispatch<SetStateAction<PoContext | null>>;
}

export function useReceivingSourcePlatform({
  poContext,
  setPoContext,
}: UseReceivingSourcePlatformArgs) {
  const updateSourcePlatform = useCallback(async (next: string) => {
    if (!poContext) return;
    const normalized = (next || '').toLowerCase();
    const packageUpdate: ReceivingPackageMeta = {
      received_at: poContext.receiving_package?.received_at ?? null,
      unboxed_at: poContext.receiving_package?.unboxed_at ?? null,
      created_at: poContext.receiving_package?.created_at ?? null,
      return_platform: poContext.receiving_package?.return_platform ?? null,
      source_platform: normalized || null,
      is_return: poContext.receiving_package?.is_return ?? false,
    };
    setPoContext((prev) => (prev ? { ...prev, receiving_package: packageUpdate } : prev));
    const receivingId = poContext.receiving_id;
    try {
      await fetch(`/api/receiving/${receivingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_platform: normalized || null }),
      });
      emitAppEvent('receiving-package-updated', {
        receiving_id: receivingId,
        source_platform: normalized || null,
      });
    } catch {
      /* silent — realtime invalidation will reconcile */
    }
  }, [poContext, setPoContext]);

  // Mirror platform changes originating from a line inspector back into the
  // top PO card's context so the label + dropdown reflect immediately.
  useEventBridge({
    'receiving-package-updated': (e) => {
      const detail = (e as CustomEvent<{ receiving_id?: number; source_platform?: string | null }>).detail;
      if (!detail || detail.source_platform === undefined) return;
      setPoContext((prev) => {
        if (!prev || prev.receiving_id !== detail.receiving_id) return prev;
        const nextPkg: ReceivingPackageMeta = {
          received_at: prev.receiving_package?.received_at ?? null,
          unboxed_at: prev.receiving_package?.unboxed_at ?? null,
          created_at: prev.receiving_package?.created_at ?? null,
          return_platform: prev.receiving_package?.return_platform ?? null,
          source_platform: (detail.source_platform || '').toLowerCase() || null,
          is_return: prev.receiving_package?.is_return ?? false,
        };
        return { ...prev, receiving_package: nextPkg };
      });
    },
  });

  return { updateSourcePlatform };
}
