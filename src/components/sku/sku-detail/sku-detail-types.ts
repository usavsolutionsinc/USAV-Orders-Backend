/** Shared types + pure helpers for the SKU detail view. */

export interface SkuDetailData {
  sku: string;
  productTitle: string | null;
  productImage: string | null;
  stock: { id: number | null; qty: number };
  catalog: {
    id: number;
    category: string | null;
    upc: string | null;
    ean: string | null;
    imageUrl: string | null;
    isActive: boolean;
  } | null;
  ecwid: {
    id: string;
    name: string;
    sku: string;
    price: number | null;
    thumbnailUrl: string | null;
    inStock: boolean;
    description: string | null;
  } | null;
  history: Array<{
    id: number;
    static_sku: string | null;
    serial_number: string | null;
    shipping_tracking_number: string | null;
    notes: string | null;
    location: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  photos: Array<{
    id: number;
    skuId: number;
    url: string;
    photoType: string | null;
    takenByStaffId: number | null;
    createdAt: string;
  }>;
  ledger: Array<{
    id: number;
    sku: string;
    delta: number;
    reason: string;
    staff_id: number | null;
    created_at: string;
  }>;
  locations: string[];
  allLocations: Array<{
    id: number;
    name: string;
    room: string | null;
    description: string | null;
    barcode: string | null;
    sort_order: number;
  }>;
  transfers: Array<{
    id: number;
    entity_type: string;
    entity_id: number;
    sku: string;
    from_location: string | null;
    to_location: string;
    staff_id: number | null;
    notes: string | null;
    created_at: string;
  }>;
}

export const REASON_OPTIONS = ['RECEIVED', 'SOLD', 'DAMAGED', 'ADJUSTMENT', 'RETURNED', 'CYCLE_COUNT'] as const;

export interface SkuDetailViewProps {
  sku: string;
  /** 'panel' = slide-in overlay (used from SkuBrowser), 'page' = full-page layout */
  variant?: 'panel' | 'page';
  /** Called when panel close button is clicked (panel variant only) */
  onClose?: () => void;
}

export function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
}
