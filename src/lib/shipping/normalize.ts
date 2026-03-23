import type { CarrierCode, NormalizedShipmentStatus } from './types';

// ─── Tracking number normalization ──────────────────────────────────────────

export function normalizeTrackingNumber(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// ─── UPS status mapping ──────────────────────────────────────────────────────
// UPS activity status types from track/v1 API

const UPS_STATUS_TYPE_MAP: Record<string, NormalizedShipmentStatus> = {
  M: 'LABEL_CREATED',      // Manifest / label created, not yet tendered
  P: 'ACCEPTED',           // Pickup at origin
  OR: 'ACCEPTED',          // Origin scan – carrier has it
  I: 'IN_TRANSIT',
  OT: 'OUT_FOR_DELIVERY',  // Out for delivery today
  D: 'DELIVERED',
  X: 'EXCEPTION',
  RS: 'RETURNED',
  NA: 'UNKNOWN',
};

export function normalizeUPSStatus(
  statusType: string | null | undefined,
  _statusCode?: string | null,
  statusDescription?: string | null
): NormalizedShipmentStatus {
  if (statusType) {
    const mapped = UPS_STATUS_TYPE_MAP[statusType.toUpperCase()];
    if (mapped) return mapped;
  }
  if (statusDescription) return normalizeUPSByText(statusDescription);
  return 'UNKNOWN';
}

function normalizeUPSByText(description: string): NormalizedShipmentStatus {
  const text = description.toUpperCase();
  if (text.includes('DELIVERED')) return 'DELIVERED';
  if (text.includes('OUT FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (
    text.includes('PICKUP') ||
    text.includes('PICKED UP') ||
    text.includes('ORIGIN SCAN') ||
    text.includes('ACCEPTED')
  ) return 'ACCEPTED';
  if (text.includes('RETURN')) return 'RETURNED';
  if (
    text.includes('EXCEPTION') ||
    text.includes('DELAY') ||
    text.includes('RESCHEDULED') ||
    text.includes('HOLD')
  ) return 'EXCEPTION';
  if (
    text.includes('IN TRANSIT') ||
    text.includes('ON THE WAY') ||
    text.includes('ARRIVED') ||
    text.includes('DEPARTED') ||
    text.includes('PROCESSING')
  ) return 'IN_TRANSIT';
  if (
    text.includes('LABEL CREATED') ||
    text.includes('SHIPMENT READY') ||
    text.includes('SHIPPER CREATED')
  ) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

// ─── USPS status mapping ─────────────────────────────────────────────────────
// The USPS v3 API surfaces a statusCategory field and per-event eventCode.

const USPS_CATEGORY_MAP: Record<string, NormalizedShipmentStatus> = {
  DELIVERED: 'DELIVERED',
  IN_TRANSIT: 'IN_TRANSIT',
  MOVING_THROUGH_NETWORK: 'IN_TRANSIT',
  ACCEPTANCE: 'ACCEPTED',
  ACCEPTED: 'ACCEPTED',
  PICKED_UP: 'ACCEPTED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  RETURN_TO_SENDER: 'RETURNED',
  RETURNED_TO_SENDER: 'RETURNED',
  EXCEPTION: 'EXCEPTION',
  ALERT: 'EXCEPTION',
  UNDELIVERABLE: 'EXCEPTION',
  PRE_SHIPMENT: 'LABEL_CREATED',
  LABEL_CREATED: 'LABEL_CREATED',
};

export function normalizeUSPSStatus(
  statusCategory: string | null | undefined,
  eventText?: string | null
): NormalizedShipmentStatus {
  if (statusCategory) {
    const key = statusCategory.toUpperCase().replace(/[\s-]/g, '_');
    const mapped = USPS_CATEGORY_MAP[key];
    if (mapped) return mapped;
  }
  if (eventText) return normalizeUSPSByText(eventText);
  return 'UNKNOWN';
}

function normalizeUSPSByText(event: string): NormalizedShipmentStatus {
  const e = event.toUpperCase();
  if (e.includes('DELIVERED')) return 'DELIVERED';
  if (e.includes('OUT FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (
    e.includes('ACCEPTED') ||
    e.includes('PICKED UP') ||
    e.includes('ACCEPTANCE') ||
    e.includes('USPS IN POSSESSION')
  )
    return 'ACCEPTED';
  if (e.includes('RETURN')) return 'RETURNED';
  if (
    e.includes('EXCEPTION') ||
    e.includes('ALERT') ||
    e.includes('UNDELIVERABLE') ||
    e.includes('FAILED ATTEMPT')
  )
    return 'EXCEPTION';
  if (
    e.includes('IN TRANSIT') ||
    e.includes('MOVING THROUGH NETWORK') ||
    e.includes('DEPARTED') ||
    e.includes('ARRIVED') ||
    e.includes('PROCESSED') ||
    e.includes('SORTING')
  )
    return 'IN_TRANSIT';
  if (
    e.includes('LABEL') ||
    e.includes('PRE-SHIPMENT') ||
    e.includes('SHIPPING LABEL') ||
    e.includes('SHIPPING INFO')
  )
    return 'LABEL_CREATED';
  return 'UNKNOWN';
}

// ─── FedEx status mapping ────────────────────────────────────────────────────
// FedEx scan event types from track/v1 API

const FEDEX_EVENT_TYPE_MAP: Record<string, NormalizedShipmentStatus> = {
  OC: 'LABEL_CREATED',    // Order created / shipment info sent to FedEx
  PU: 'ACCEPTED',         // Picked up
  AO: 'ACCEPTED',         // Arrived at FedEx origin facility
  AR: 'IN_TRANSIT',       // Arrived at FedEx facility
  AF: 'IN_TRANSIT',       // At FedEx destination facility
  IT: 'IN_TRANSIT',
  OD: 'OUT_FOR_DELIVERY', // On FedEx vehicle for delivery
  DL: 'DELIVERED',
  DE: 'EXCEPTION',        // Delivery exception
  HL: 'EXCEPTION',        // Hold at location
  RS: 'RETURNED',         // Return to shipper
  CA: 'RETURNED',         // Cancelled
};

export function normalizeFedExStatus(
  eventType: string | null | undefined,
  description?: string | null
): NormalizedShipmentStatus {
  if (eventType) {
    const mapped = FEDEX_EVENT_TYPE_MAP[eventType.toUpperCase()];
    if (mapped) return mapped;
  }
  if (description) return normalizeFedExByText(description);
  return 'UNKNOWN';
}

function normalizeFedExByText(description: string): NormalizedShipmentStatus {
  const text = description.toUpperCase();
  if (text.includes('DELIVERED')) return 'DELIVERED';
  if (text.includes('OUT FOR DELIVERY') || text.includes('ON FEDEX VEHICLE FOR DELIVERY')) return 'OUT_FOR_DELIVERY';
  if (text.includes('PICKED UP') || text.includes('ACCEPTED')) return 'ACCEPTED';
  if (text.includes('RETURN')) return 'RETURNED';
  if (text.includes('EXCEPTION') || text.includes('DELAY') || text.includes('HELD')) return 'EXCEPTION';
  if (text.includes('IN TRANSIT') || text.includes('AT LOCAL FEDEX FACILITY') || text.includes('ARRIVED')) return 'IN_TRANSIT';
  if (text.includes('LABEL CREATED') || text.includes('SHIPMENT INFORMATION SENT')) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

// ─── Carrier auto-detection ──────────────────────────────────────────────────

export function detectCarrier(normalized: string): CarrierCode | null {
  // UPS: starts with 1Z, 18 characters
  if (/^1Z[A-Z0-9]{16}$/.test(normalized)) return 'UPS';
  // FedEx: 12, 15, or 20 digits
  if (/^\d{12}$/.test(normalized)) return 'FEDEX';
  if (/^\d{15}$/.test(normalized)) return 'FEDEX';
  if (/^\d{20}$/.test(normalized)) return 'FEDEX';
  if (/^9621\d{29}$/.test(normalized)) return 'FEDEX';
  // USPS: 20-22 digits, or starts with 9
  if (/^9\d{15,21}$/.test(normalized)) return 'USPS';
  if (/^\d{20,22}$/.test(normalized)) return 'USPS';
  return null;
}

// ─── Polling cadence ─────────────────────────────────────────────────────────

export function computeNextCheckAt(
  status: NormalizedShipmentStatus,
  consecutiveErrors: number = 0
): Date | null {
  if (status === 'DELIVERED') return null;

  const baseOffsets: Record<NormalizedShipmentStatus, number> = {
    LABEL_CREATED: 8 * 60 * 60 * 1000,
    ACCEPTED: 4 * 60 * 60 * 1000,
    IN_TRANSIT: 2 * 60 * 60 * 1000,
    OUT_FOR_DELIVERY: 45 * 60 * 1000,
    DELIVERED: 0,
    EXCEPTION: 3 * 60 * 60 * 1000,
    RETURNED: 12 * 60 * 60 * 1000,
    UNKNOWN: 6 * 60 * 60 * 1000,
  };

  let offset = baseOffsets[status] ?? baseOffsets.UNKNOWN;

  if (consecutiveErrors > 0) {
    const backoffMultiplier = Math.min(Math.pow(2, consecutiveErrors - 1), 16);
    offset = offset * backoffMultiplier;
  }

  return new Date(Date.now() + offset);
}
