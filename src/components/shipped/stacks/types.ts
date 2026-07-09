import { ShippedOrder } from '@/lib/neon/orders-queries';
import type { PanelActionBarConfig } from '@/components/shipped/details-panel/PanelActionBar';
// These two unions live here (the leaf) so the panels can import them downward.
export type ShippedActiveSection = 'shipping' | 'product' | 'timeline' | 'customer' | 'documents';
export type ShippedActiveInput = 'none' | 'mark_shipped' | 'out_of_stock' | 'notes';

export interface DetailsStackDurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

export interface DetailsStackProps {
  shipped: ShippedOrder;
  durationData: DetailsStackDurationData;
  copiedAll: boolean;
  onCopyAll: () => void;
  onUpdate?: () => void;
  showShippingTimestamp?: boolean;
  mode?: 'dashboard' | 'tech';
  showAssignmentButton?: boolean;
  actionBar?: PanelActionBarConfig;
  /** Optional tab gating from ShippedDetailsPanel. Undefined keeps the legacy single-scroll layout. */
  activeSection?: ShippedActiveSection;
}
