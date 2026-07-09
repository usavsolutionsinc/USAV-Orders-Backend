'use client';

/**
 * The dashboard's right-side details panel. A selected order opens either the
 * Unshipped (queue) editor or the Shipped details panel depending on its
 * context; the choice + selection live in useDashboardSelectedOrder. Wrapped in
 * AnimatePresence for the slide in/out. Extracted from the dashboard page.
 */

import { AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import type { ShippedOrder } from '@/types/orders';
import type { ShippedDetailsContext } from '@/utils/events';

// Phase 4 (bundle deferral): the detail panels load on FIRST open (a row click),
// not in the initial dashboard bundle. `ssr: false` — they're client-only
// slide-overs already gated behind a selection, so a null-while-loading is invisible.
const ShippedDetailsPanel = dynamic(
  () => import('@/components/shipped').then((m) => m.ShippedDetailsPanel),
  { ssr: false },
);
const UnshippedDetailsPanel = dynamic(
  () => import('@/components/unshipped/UnshippedDetailsPanel').then((m) => m.UnshippedDetailsPanel),
  { ssr: false },
);

interface DashboardOrderDetailsProps {
  detailsEnabled: boolean;
  selectedShipped: ShippedOrder | null;
  selectedContext: ShippedDetailsContext;
  onClose: () => void;
  onUpdate: () => void;
}

export function DashboardOrderDetails({
  detailsEnabled,
  selectedShipped,
  selectedContext,
  onClose,
  onUpdate,
}: DashboardOrderDetailsProps) {
  return (
    <AnimatePresence>
      {detailsEnabled && selectedShipped && (
        selectedContext === 'queue' ? (
          <UnshippedDetailsPanel shipped={selectedShipped} onClose={onClose} onUpdate={onUpdate} />
        ) : (
          <ShippedDetailsPanel
            shipped={selectedShipped}
            context="dashboard"
            onClose={onClose}
            onUpdate={onUpdate}
          />
        )
      )}
    </AnimatePresence>
  );
}
