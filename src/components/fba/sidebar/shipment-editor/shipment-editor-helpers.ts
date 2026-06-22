import type { TrackingBundleDraft } from '@/components/fba/sidebar/FbaTrackingBundleCard';
import type { StationTheme } from '@/utils/staff-colors';
import type { ActiveShipment, ShipmentCardItem } from '@/lib/fba/types';

export const UNALLOCATED_ID = 'editor-unallocated';
export const UNDO_STORAGE_KEY = 'fba-editor-undo';
export const UNDO_EXPIRY_MS = 5 * 60 * 1000;

export interface FbaShipmentEditorFormProps {
  shipment: ActiveShipment;
  stationTheme?: StationTheme;
  onClose: () => void;
  onChanged: () => void;
}

// ── Undo ─────────────────────────────────────────────────────────────────────

export interface UndoEntry {
  item_id: number;
  fnsku: string;
  display_title: string;
  expected_qty: number;
  bundleIndex: number | null;
  removedAt: number;
}

/** Move-undo: tracks items recently moved to unallocated (qty-to-0 deallocate or
 *  bundle trash). Keyed by bundle link_id / tracking_number so lookups stay
 *  stable even if indexes shift or the bundle gets recreated via undo. */
export type MoveUndoEntry = {
  qty: number;
  maxQty: number;
  link_id: number | null;
  tracking_number: string;
  carrier: string;
};

export function loadUndoStack(shipmentId: number): UndoEntry[] {
  try {
    const raw = localStorage.getItem(`${UNDO_STORAGE_KEY}-${shipmentId}`);
    if (!raw) return [];
    const entries: UndoEntry[] = JSON.parse(raw);
    const now = Date.now();
    return entries.filter((e) => now - e.removedAt < UNDO_EXPIRY_MS);
  } catch { return []; }
}

export function saveUndoStack(shipmentId: number, stack: UndoEntry[]) {
  try {
    const now = Date.now();
    const valid = stack.filter((e) => now - e.removedAt < UNDO_EXPIRY_MS);
    if (valid.length === 0) localStorage.removeItem(`${UNDO_STORAGE_KEY}-${shipmentId}`);
    else localStorage.setItem(`${UNDO_STORAGE_KEY}-${shipmentId}`, JSON.stringify(valid));
  } catch { /* ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize the /plan-items API rows into the editor's working item shape. */
export function mapPlanItems(rows: unknown[], shipmentId: number): ShipmentCardItem[] {
  return (rows as Array<Record<string, unknown>>).map((i) => ({
    item_id: Number(i.id),
    fnsku: String(i.fnsku ?? ''),
    display_title: String(i.display_title || i.product_title || i.fnsku || ''),
    expected_qty: Number(i.expected_qty) || 0,
    actual_qty: Number(i.actual_qty) || 0,
    status: i.status as ShipmentCardItem['status'],
    shipment_id: shipmentId,
  }));
}

export function buildInitialBundles(shipment: ActiveShipment): TrackingBundleDraft[] {
  return shipment.bundles.map((b) => ({
    link_id: b.link_id,
    tracking_number: b.tracking_number,
    carrier: b.carrier,
    collapsed: false,
    allocations: b.items.map((item) => ({
      item_id: item.item_id,
      fnsku: item.fnsku,
      display_title: item.display_title,
      qty: item.expected_qty,
      max_qty: item.expected_qty,
    })),
  }));
}

export function droppableIdForBundle(idx: number): string {
  return `editor-bundle-${idx}`;
}

export function parseBundleIndex(droppableId: string): number | null {
  if (droppableId === UNALLOCATED_ID) return null;
  const m = droppableId.match(/^editor-bundle-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Find which container an item lives in. */
export function findItemContainer(
  bundles: TrackingBundleDraft[],
  unallocatedItems: ShipmentCardItem[],
  itemId: number,
): string | null {
  for (let i = 0; i < bundles.length; i++) {
    if (bundles[i].allocations.some((a) => a.item_id === itemId)) return droppableIdForBundle(i);
  }
  if (unallocatedItems.some((it) => it.item_id === itemId)) return UNALLOCATED_ID;
  return null;
}
