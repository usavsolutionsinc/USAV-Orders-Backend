import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import type { CarrierCode, ShipmentStatusCategory } from '@/components/shipping/ShipmentStatusBadge';

export const CARRIERS: ReadonlyArray<{ value: CarrierCode; label: string }> = [
  { value: 'UPS', label: 'UPS' },
  { value: 'USPS', label: 'USPS' },
  { value: 'FEDEX', label: 'FedEx' },
];

export const STATUS_CATEGORIES: ReadonlyArray<{ value: ShipmentStatusCategory; label: string }> = [
  { value: 'LABEL_CREATED', label: 'Label created' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'EXCEPTION', label: 'Exception' },
  { value: 'RETURNED', label: 'Returned' },
];

export const VALID_CARRIERS = new Set(CARRIERS.map((c) => c.value));
export const VALID_STATUS = new Set(STATUS_CATEGORIES.map((s) => s.value));

export type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

export interface StaffOption {
  id: number;
  name: string;
}

// Type filter is a *view switcher* (Shopify-style segmented tabs), not a refinement.
export const TYPE_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'sku', label: 'SKU' },
  { id: 'fba', label: 'FBA' },
];

export const CARRIER_LABEL = new Map(CARRIERS.map((c) => [c.value, c.label]));
export const STATUS_LABEL = new Map(STATUS_CATEGORIES.map((s) => [s.value, s.label]));
export const TYPE_LABEL = new Map(TYPE_ITEMS.map((t) => [String(t.id), t.label]));
