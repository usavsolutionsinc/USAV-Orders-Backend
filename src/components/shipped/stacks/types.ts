import { ShippedOrder } from '@/lib/neon/orders-queries';
import type { PanelActionBarConfig } from '@/components/shipped/details-panel/PanelActionBar';
// These two unions live here (the leaf) so the panels can import them downward.
export type ShippedActiveSection = 'return' | 'shipping' | 'product' | 'timeline' | 'customer';
export type ShippedActiveInput = 'none' | 'out_of_stock' | 'notes';

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
  showReturnInformation?: boolean;
  /** Optional tab gating from ShippedDetailsPanel. Undefined keeps the legacy single-scroll layout. */
  activeSection?: ShippedActiveSection;
  /** Lifted inline-editor state from ShippedDetailsPanel (out-of-stock / notes triggers). */
  activeInput?: ShippedActiveInput;
  setActiveInput?: (next: ShippedActiveInput | ((prev: ShippedActiveInput) => ShippedActiveInput)) => void;
  /** Lifted MarkAsShipped toggle state. */
  isMarkAsShippedOpen?: boolean;
  setIsMarkAsShippedOpen?: (next: boolean | ((prev: boolean) => boolean)) => void;
}
