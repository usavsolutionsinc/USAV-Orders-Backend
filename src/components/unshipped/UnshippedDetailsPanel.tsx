'use client';

import { ShippedOrder } from '@/lib/neon/orders-queries';
import { ShippedDetailsPanel } from '@/components/shipped/ShippedDetailsPanel';

interface UnshippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
}

export function UnshippedDetailsPanel(props: UnshippedDetailsPanelProps) {
  return <ShippedDetailsPanel {...props} context="queue" />;
}
