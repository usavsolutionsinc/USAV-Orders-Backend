'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { safeRandomUUID } from '@/lib/safe-uuid';
import { dispatchDashboardAndStationRefresh } from '@/utils/events';
import type { AmendmentTimelineRow } from '@/lib/timeline';
import type { PickOrderTasks } from '@/lib/picking/sessions';

/**
 * Client data layer for fulfillment substitution. Three hooks the testing /
 * packing cards compose:
 *   - useOrderPickTasks  → the order's open allocations (the "original" context;
 *                          carries allocationId + sku/condition/serial).
 *   - useOrderAmendments → the order's substitution history (for the timeline).
 *   - useSubstituteUnit / useDecideAmendment → the mutations.
 *
 * Each mutation threads a fresh clientEventId (safeRandomUUID — crypto.randomUUID
 * crashes over plain-HTTP LAN IPs) so a flaky-network retry is the idempotent
 * no-op the server already guarantees (UNIQUE client_event_id). On success they
 * invalidate the amendments + pick-tasks queries so the card reconciles.
 */

export const orderAmendmentsKey = (orderId: number) => ['order-amendments', orderId] as const;
export const orderPickTasksKey = (orderId: number) => ['order-pick-tasks', orderId] as const;

export function useOrderPickTasks(orderId: number | null | undefined) {
  return useQuery({
    queryKey: orderPickTasksKey(Number(orderId)),
    enabled: typeof orderId === 'number' && orderId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/pick-tasks`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load pick tasks');
      return data as PickOrderTasks;
    },
  });
}

export function useOrderAmendments(orderId: number | null | undefined) {
  return useQuery({
    queryKey: orderAmendmentsKey(Number(orderId)),
    enabled: typeof orderId === 'number' && orderId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/amendments`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load amendments');
      return (data.amendments ?? []) as AmendmentTimelineRow[];
    },
  });
}

export interface SubstituteVars {
  orderId: number;
  originalAllocationId: number;
  /** One of substituteSerial / substituteUnitId. */
  substituteSerial?: string;
  substituteUnitId?: number;
  reasonCode: string;
  customerRequestNote?: string;
  photoId?: number | null;
  raisedAtNode?: 'pick' | 'test' | 'pack';
}

export function useSubstituteUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: SubstituteVars) => {
      const res = await fetch(`/api/orders/${vars.orderId}/substitute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_allocation_id: vars.originalAllocationId,
          substitute_serial: vars.substituteSerial,
          substitute_unit_id: vars.substituteUnitId,
          reason_code: vars.reasonCode,
          customer_request_note: vars.customerRequestNote,
          photo_id: vars.photoId ?? undefined,
          raised_at_node: vars.raisedAtNode ?? 'test',
          client_event_id: safeRandomUUID(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Substitution failed');
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: orderAmendmentsKey(vars.orderId) });
      qc.invalidateQueries({ queryKey: orderPickTasksKey(vars.orderId) });
      // Post-submit reconciliation (tech-substitution wiring §5 Phase 2.1):
      // the substitution re-allocates the unit shipping on the order, so the
      // tech history table (['tech-logs', techId]) and the station/dashboard
      // tables listening for 'usav-refresh-data' must refetch. Prefix-match
      // invalidation covers every techId variant; the window event is the
      // house-wide refresh signal (src/utils/events.ts).
      qc.invalidateQueries({ queryKey: ['tech-logs'] });
      dispatchDashboardAndStationRefresh();
    },
  });
}

export interface DecideVars {
  amendmentId: number;
  orderId: number;
  decision: 'approve' | 'reject';
}

export function useDecideAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: DecideVars) => {
      const res = await fetch(`/api/order-amendments/${vars.amendmentId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: vars.decision, client_event_id: safeRandomUUID() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Decision failed');
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: orderAmendmentsKey(vars.orderId) });
      qc.invalidateQueries({ queryKey: orderPickTasksKey(vars.orderId) });
    },
  });
}
