/**
 * Shared FBA item mutation helpers.
 *
 * Consolidates the duplicate PATCH / DELETE logic that was spread across
 * FbaBoardDetailPanel, ItemExpandPanel, and inline fetch calls.
 */

import { fbaPaths } from './api-paths';

/** PATCH an FBA shipment item. Returns `true` on success. */
export async function patchFbaItem(
  shipmentId: number,
  itemId: number,
  body: Record<string, unknown>,
): Promise<boolean> {
  const res = await fetch(fbaPaths.planItem(shipmentId, itemId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** PATCH and return the updated row (used by the print-queue table). */
export async function patchFbaItemWithResponse<T = unknown>(
  shipmentId: number,
  itemId: number,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; item?: T }> {
  const res = await fetch(fbaPaths.planItem(shipmentId, itemId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) return { ok: false };
  return { ok: true, item: data.item };
}

/** DELETE an FBA shipment item. */
export async function deleteFbaItem(
  shipmentId: number,
  itemId: number,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(fbaPaths.planItem(shipmentId, itemId), {
    method: 'DELETE',
  });
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, error: data?.error || `Delete failed (${res.status})` };
}
