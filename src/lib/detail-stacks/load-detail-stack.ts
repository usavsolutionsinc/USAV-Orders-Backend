'use client';

/**
 * Fetch detail-stack entity data for global slide-over open (no navigation).
 */

import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import { fetchDashboardOrderRowById } from '@/lib/dashboard-table-data';
import type { FbaBoardItem } from '@/lib/fba/types';
import { fetchReceivingDetailsEnrich } from '@/lib/receiving/receiving-details-overlay';
import type { ShippedOrder } from '@/types/orders';
import { normalizeDashboardDetailsContext } from '@/utils/dashboard-search-state';
import type { ShippedDetailsContext } from '@/utils/events';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { DetailStackKind } from './registry';

export type LoadedDetailStack =
  | { kind: 'order'; order: ShippedOrder; context: ShippedDetailsContext }
  | { kind: 'receiving'; log: ReceivingDetailsLog }
  | { kind: 'plan'; item: FbaBoardItem }
  | { kind: 'claim'; repair: RSRecord }
  | { kind: 'missing' };

export async function loadDetailStack(stack: {
  kind: DetailStackKind;
  id: string;
}): Promise<LoadedDetailStack> {
  const id = stack.id.trim();
  if (!id) return { kind: 'missing' };

  switch (stack.kind) {
    case 'order': {
      const orderId = Number(id);
      if (!Number.isFinite(orderId) || orderId <= 0) return { kind: 'missing' };
      const order = await fetchDashboardOrderRowById(orderId);
      if (!order) return { kind: 'missing' };
      return { kind: 'order', order, context: normalizeDashboardDetailsContext(order) };
    }
    case 'receiving': {
      const receivingId = Number(id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) return { kind: 'missing' };
      const result = await fetchReceivingDetailsEnrich(receivingId);
      if (result.kind === 'local_pickup') {
        return loadDetailStack({ kind: 'order', id: String(result.orderId) });
      }
      if (result.kind !== 'details') return { kind: 'missing' };
      return { kind: 'receiving', log: result.log };
    }
    case 'shipment':
    case 'plan': {
      const shipmentId = Number(id);
      if (!Number.isFinite(shipmentId) || shipmentId <= 0) return { kind: 'missing' };
      const item = await loadFbaBoardItemByShipmentId(shipmentId);
      if (!item) return { kind: 'missing' };
      return { kind: 'plan', item };
    }
    case 'claim': {
      const repairId = Number(id);
      if (!Number.isFinite(repairId) || repairId <= 0) return { kind: 'missing' };
      const res = await fetch(`/api/repair-service/${repairId}`, { cache: 'no-store' });
      if (!res.ok) return { kind: 'missing' };
      const repair = (await res.json()) as RSRecord;
      if (!repair?.id) return { kind: 'missing' };
      return { kind: 'claim', repair };
    }
    default:
      return { kind: 'missing' };
  }
}

async function loadFbaBoardItemByShipmentId(shipmentId: number): Promise<FbaBoardItem | null> {
  const res = await fetch('/api/fba/board', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    pending?: FbaBoardItem[];
    packed?: FbaBoardItem[];
    awaiting?: FbaBoardItem[];
  };
  const pending = data.pending ?? [...(data.packed ?? []), ...(data.awaiting ?? [])];
  return pending.find((it) => Number(it.shipment_id) === shipmentId) ?? null;
}
