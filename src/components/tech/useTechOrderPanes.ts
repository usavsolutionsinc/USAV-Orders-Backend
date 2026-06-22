'use client';

/**
 * Right-pane order state for the tech dashboard's shipping mode:
 *   - `activeOrderPane` — a scanned/active order, dispatched by
 *     `useStationTestingController` via `tech-active-order-changed` (null clears
 *     it, returning the pane to the history table).
 *   - `previewOrder` — an Up Next card click (`tech-upnext-preview`); lower
 *     priority than the active order, which clears any standing preview.
 * Extracted from TechDashboard; behaviour is unchanged.
 */

import { useEffect, useState } from 'react';
import type { ActiveStationOrder, ResolvedProductManual } from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';
import type { UpNextPreviewPayload } from '@/utils/events';

export interface TechActiveOrderPane {
  activeOrder: ActiveStationOrder;
  manuals: ResolvedProductManual[];
  isManualLoading: boolean;
}

export interface TechOrderPanes {
  activeOrderPane: TechActiveOrderPane | null;
  setActiveOrderPane: React.Dispatch<React.SetStateAction<TechActiveOrderPane | null>>;
  previewOrder: Order | null;
  setPreviewOrder: React.Dispatch<React.SetStateAction<Order | null>>;
}

export function useTechOrderPanes(): TechOrderPanes {
  // Populated by `tech-active-order-changed` from useStationTestingController.
  // When set, the history branch crossfades into <ActiveOrderWorkspace/>.
  const [activeOrderPane, setActiveOrderPane] = useState<TechActiveOrderPane | null>(null);
  // Populated by `tech-upnext-preview` (a tech clicked an Up Next card). Lower
  // priority than the active order: if both are set, active wins.
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  // Active-order changes from the sidebar controller. Null clears the pane back
  // to history; a resolved active order also clears any standing preview.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TechActiveOrderPane | null>).detail;
      setActiveOrderPane(detail || null);
      if (detail) setPreviewOrder(null);
    };
    window.addEventListener('tech-active-order-changed', handler);
    return () => window.removeEventListener('tech-active-order-changed', handler);
  }, []);

  // Up Next card clicks — preview an order in the right pane.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpNextPreviewPayload>).detail;
      if (detail && detail.kind === 'order') {
        setPreviewOrder(detail.order);
      } else {
        setPreviewOrder(null);
      }
    };
    window.addEventListener('tech-upnext-preview', handler);
    return () => window.removeEventListener('tech-upnext-preview', handler);
  }, []);

  return { activeOrderPane, setActiveOrderPane, previewOrder, setPreviewOrder };
}
