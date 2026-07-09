/**
 * Fulfillment mode — commerce identity (platform · PO) vs how the carton
 * arrived (carrier shipment vs local pickup). Pure SoT for chip + tracking display.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { effectiveIntakeKind } from '@/lib/receiving/kinds/registry';

/** Zoho PO whose reference#/number/id contains LCPU or LOCALPICKUP. */
export function isLocalPickupPo(...candidates: Array<string | null | undefined>): boolean {
  const re = /(LCPU|LOCALPICKUP)/i;
  for (const value of candidates) {
    if (typeof value === 'string' && re.test(value)) return true;
  }
  return false;
}

/** Inventory / Zoho placeholder text stored where a tracking# would live. */
export function isPlaceholderTracking(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v) return false;
  if (/^local\s*pickup$/i.test(v)) return true;
  return isLocalPickupPo(v);
}

type FulfillmentRow = Pick<
  ReceivingLineRow,
  | 'receiving_source'
  | 'receiving_type'
  | 'carton_intake_type'
  | 'intake_type'
  | 'carrier'
  | 'tracking_number'
  | 'zoho_reference_number'
  | 'zoho_purchaseorder_number'
  | 'zoho_purchaseorder_id'
>;

/** True when the carton was picked up locally — not a carrier-shipped parcel. */
export function isLocalPickupFulfillment(row: FulfillmentRow): boolean {
  if (row.receiving_source === 'local_pickup') return true;
  if (
    effectiveIntakeKind(row.intake_type || row.receiving_type, row.carton_intake_type) === 'PICKUP'
  ) {
    return true;
  }
  if ((row.carrier || '').trim().toUpperCase() === 'LOCAL') return true;
  if (isPlaceholderTracking(row.tracking_number)) return true;
  if (isPlaceholderTracking(row.zoho_reference_number)) return true;
  return isLocalPickupPo(
    row.zoho_reference_number,
    row.zoho_purchaseorder_number,
    row.zoho_purchaseorder_id,
  );
}

/** Tracking# for chip display — null when pickup or placeholder (suppress chip). */
export function displayTrackingNumber(
  row: Pick<ReceivingLineRow, 'tracking_number'> & FulfillmentRow,
): string | null {
  if (isLocalPickupFulfillment(row)) return null;
  const trk = (row.tracking_number || '').trim();
  if (!trk || isPlaceholderTracking(trk)) return null;
  return trk;
}

/** Short label for the tracking column when fulfillment is local pickup. */
export function fulfillmentModeLabel(row: FulfillmentRow): 'Pickup' | null {
  return isLocalPickupFulfillment(row) ? 'Pickup' : null;
}
