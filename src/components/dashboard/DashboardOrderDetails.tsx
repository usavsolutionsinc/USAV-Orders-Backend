'use client';

/**
 * The dashboard's right-side details panel. A selected order opens either the
 * Unshipped (queue) editor or the Shipped details panel depending on its
 * context; the choice + selection live in useDashboardSelectedOrder. Wrapped in
 * AnimatePresence for the slide in/out. Extracted from the dashboard page.
 */

import { AnimatePresence } from 'framer-motion';
import { ShippedDetailsPanel } from '@/components/shipped';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import type { ShippedOrder } from '@/types/orders';
import type { ShippedDetailsContext } from '@/utils/events';

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
