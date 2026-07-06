'use client';

/**
 * DetailStackHistoryTracker — watches the URL for any known detail-stack open
 * param (openShipmentId, openReceivingId, …) and records it into the
 * recent-detail-stacks history the context rail shows. Zero per-page wiring:
 * every page that already deep-links a slide-over via one of these params is
 * captured for free.
 *
 * Renders nothing. Mounted once by AssistantProvider inside a Suspense boundary
 * (useSearchParams requires it in the App Router).
 */

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { recordDetailStack } from '@/lib/detail-stacks/history-store';
import { DETAIL_STACK_DEFS, DETAIL_STACK_PARAMS } from '@/lib/detail-stacks/registry';

function shorten(id: string): string {
  return id.length > 10 ? `…${id.slice(-6)}` : `#${id}`;
}

export function DetailStackHistoryTracker(): null {
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    for (const { kind, param } of DETAIL_STACK_PARAMS) {
      const id = params.get(param);
      if (!id) continue;
      const def = DETAIL_STACK_DEFS[kind];
      recordDetailStack({
        kind,
        id,
        label: `${def.noun} ${shorten(id)}`,
        path: pathname,
        search: params.toString(),
      });
    }
  }, [pathname, params]);

  return null;
}
