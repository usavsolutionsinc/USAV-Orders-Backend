import type { DayBucket, EnrichedItem, ItemStatus, PendingReason, PrintQueueItem, ShipmentGroup } from './types';
import { getTodayDateIso } from '@/components/fba/utils/getTodayDate';

export function dueDateLabel(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: 'No ship-by date', cls: 'text-zinc-400' };
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, cls: 'text-red-600 font-semibold' };
  if (diff === 0) return { text: 'Ship today', cls: 'text-orange-600 font-semibold' };
  if (diff <= 3) return { text: `${diff}d left`, cls: 'text-violet-700 font-semibold' };
  return { text: `${diff}d left`, cls: 'text-zinc-500' };
}

function parseQcNote(notes: string | null | undefined): { isQc: boolean; rest: string } {
  const n = notes?.trim() || '';
  if (n.startsWith('QC_FAIL:')) return { isQc: true, rest: n.slice(8).trim() };
  return { isQc: false, rest: n };
}

export function deriveItemStatus(row: PrintQueueItem): {
  status: ItemStatus;
  pending_reason: PendingReason;
  pending_reason_note?: string;
} {
  const s = String(row.item_status || '').toUpperCase();
  const fromApiReason = row.pending_reason as PendingReason | undefined;
  const note = row.pending_reason_note ?? row.item_notes ?? '';
  const qc = parseQcNote(note);

  if (s === 'SHIPPED') {
    return { status: 'shipped', pending_reason: null };
  }
  if (qc.isQc || fromApiReason === 'qc_fail') {
    return {
      status: 'pending_qc_fail',
      pending_reason: 'qc_fail',
      pending_reason_note: qc.isQc ? qc.rest || undefined : row.pending_reason_note || undefined,
    };
  }
  if (s === 'OUT_OF_STOCK' || fromApiReason === 'out_of_stock') {
    return {
      status: 'pending_out_of_stock',
      pending_reason: 'out_of_stock',
      pending_reason_note: row.pending_reason_note || row.item_notes || undefined,
    };
  }
  if (s === 'PACKING') {
    return { status: 'needs_print', pending_reason: null };
  }
  return { status: 'ready_to_print', pending_reason: null };
}

export function enrichFromApi(row: PrintQueueItem & { status?: string; notes?: string | null }): EnrichedItem {
  const merged: PrintQueueItem = {
    ...row,
    item_status: row.item_status || String(row.status || ''),
    item_notes: row.item_notes ?? row.notes ?? null,
  };
  const { status, pending_reason, pending_reason_note } = deriveItemStatus(merged);
  return {
    ...merged,
    status,
    pending_reason,
    pending_reason_note,
    expanded: false,
  };
}

export function dayKeyFromDue(iso: string | null): string {
  if (!iso) return '__nodate__';
  return String(iso).slice(0, 10);
}

export function formatDayBucketLabel(dayKey: string): string {
  if (dayKey === '__nodate__') return 'No due date';
  const today = getTodayDateIso();
  const t = new Date(today + 'T12:00:00');
  const d = new Date(dayKey + 'T12:00:00');
  const diffDays = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  const [y, m, day] = dayKey.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  const wd = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (diffDays === 0) return `Today · ${wd}`;
  if (diffDays === 1) return `Tomorrow · ${wd}`;
  if (diffDays === -1) return `Yesterday · ${wd}`;
  return wd;
}

export function groupByDayThenShipment(items: EnrichedItem[]): DayBucket[] {
  const dayMap = new Map<string, Map<number, ShipmentGroup>>();

  for (const item of items) {
    const dk = dayKeyFromDue(item.due_date);
    if (!dayMap.has(dk)) dayMap.set(dk, new Map());
    const sm = dayMap.get(dk)!;
    if (!sm.has(item.shipment_id)) {
      sm.set(item.shipment_id, {
        shipment_id: item.shipment_id,
        shipment_ref: item.shipment_ref,
        amazon_shipment_id: item.amazon_shipment_id,
        due_date: item.due_date,
        destination_fc: item.destination_fc,
        items: [],
      });
    }
    sm.get(item.shipment_id)!.items.push(item);
  }

  for (const sm of Array.from(dayMap.values())) {
    for (const g of Array.from(sm.values())) {
      g.items = sortItemsPrintQueueOrder(g.items);
    }
  }

  const keys = Array.from(dayMap.keys()).sort((a, b) => {
    if (a === '__nodate__') return 1;
    if (b === '__nodate__') return -1;
    return a.localeCompare(b);
  });

  return keys.map((dayKey) => ({
    dayKey,
    label: formatDayBucketLabel(dayKey),
    groups: Array.from(dayMap.get(dayKey)!.values()),
  }));
}

export function groupByShipmentOnly(items: EnrichedItem[]): ShipmentGroup[] {
  const map = new Map<number, ShipmentGroup>();
  for (const item of items) {
    if (!map.has(item.shipment_id)) {
      map.set(item.shipment_id, {
        shipment_id: item.shipment_id,
        shipment_ref: item.shipment_ref,
        amazon_shipment_id: item.amazon_shipment_id,
        due_date: item.due_date,
        destination_fc: item.destination_fc,
        items: [],
      });
    }
    map.get(item.shipment_id)!.items.push(item);
  }
  for (const g of Array.from(map.values())) {
    g.items = sortItemsPrintQueueOrder(g.items);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
    const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
    if (ad !== bd) return ad - bd;
    return a.shipment_id - b.shipment_id;
  });
}

export function sortEnrichedItems(a: EnrichedItem, b: EnrichedItem): number {
  if (a.shipment_id !== b.shipment_id) return a.shipment_id - b.shipment_id;
  return a.fnsku.localeCompare(b.fnsku);
}

/** Pending / needs-print first; ready-to-print last (labels queue below). */
export function sortItemsPrintQueueOrder(items: EnrichedItem[]): EnrichedItem[] {
  const rank = (s: EnrichedItem['status']) => {
    switch (s) {
      case 'pending_out_of_stock':
        return 0;
      case 'pending_qc_fail':
        return 1;
      case 'needs_print':
        return 2;
      case 'ready_to_print':
        return 3;
      case 'shipped':
        return 4;
      default:
        return 9;
    }
  };
  return [...items].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return a.fnsku.localeCompare(b.fnsku);
  });
}

export function partitionPrintQueueByReady(items: EnrichedItem[]) {
  const attention = items.filter((i) => i.status !== 'ready_to_print');
  const ready = items.filter((i) => i.status === 'ready_to_print');
  return { attention, ready };
}
