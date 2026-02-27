'use client';

import { ShippedOrder } from '@/lib/neon/orders-queries';
import { ShippedDetailsPanel as LegacyShippedDetailsPanel } from '@/components/shipped/ShippedDetailsPanelLegacy';

interface UnshippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
}

export function UnshippedDetailsPanel(props: UnshippedDetailsPanelProps) {
  return <LegacyShippedDetailsPanel {...props} />;
}

