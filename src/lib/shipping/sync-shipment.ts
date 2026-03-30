import type { CarrierCode } from './types';
import { detectCarrier, normalizeTrackingNumber } from './normalize';
import {
  getShipmentById,
  getShipmentByTracking,
  upsertShipment,
  upsertTrackingEvents,
  updateShipmentSummary,
  updateShipmentError,
} from './repository';
import { publishShipmentStatusChange } from './publish-on-status-change';
import * as ups from './providers/ups';
import * as usps from './providers/usps';
import * as fedex from './providers/fedex';

export interface SyncShipmentInput {
  shipmentId?: number;
  trackingNumber?: string;
  carrier?: CarrierCode;
}

export interface SyncShipmentResult {
  ok: boolean;
  shipmentId?: number;
  status?: string;
  eventsInserted?: number;
  error?: string;
  errorCode?: string;
}

function getProvider(carrier: CarrierCode) {
  switch (carrier) {
    case 'UPS': return ups;
    case 'USPS': return usps;
    case 'FEDEX': return fedex;
  }
}

export async function syncShipment(input: SyncShipmentInput): Promise<SyncShipmentResult> {
  let shipment =
    input.shipmentId != null
      ? await getShipmentById(input.shipmentId)
      : null;

  if (!shipment && input.trackingNumber) {
    const normalized = normalizeTrackingNumber(input.trackingNumber);
    shipment = await getShipmentByTracking(normalized);

    if (!shipment) {
      const carrier =
        input.carrier ?? detectCarrier(normalized);

      if (!carrier) {
        return {
          ok: false,
          error: `Cannot detect carrier for tracking number: ${normalized}`,
          errorCode: 'UNKNOWN_CARRIER',
        };
      }

      shipment = await upsertShipment({
        trackingNumberRaw: input.trackingNumber,
        trackingNumberNormalized: normalized,
        carrier,
      });
    }
  }

  if (!shipment) {
    return {
      ok: false,
      error: 'Shipment not found and no tracking number provided',
      errorCode: 'NOT_FOUND',
    };
  }

  if (shipment.is_terminal) {
    return {
      ok: true,
      shipmentId: shipment.id,
      status: shipment.latest_status_category ?? 'DELIVERED',
      eventsInserted: 0,
    };
  }

  const carrier = shipment.carrier as CarrierCode;
  const provider = getProvider(carrier);

  try {
    const result = await provider.trackByNumber(shipment.tracking_number_normalized);

    const inserted = await upsertTrackingEvents(
      shipment.id,
      carrier,
      shipment.tracking_number_normalized,
      result.events
    );

    await updateShipmentSummary(shipment.id, result);
    await publishShipmentStatusChange(shipment.id, 'shipping-sync');

    return {
      ok: true,
      shipmentId: shipment.id,
      status: result.latestStatusCategory,
      eventsInserted: inserted,
    };
  } catch (err: any) {
    const code = err?.code ?? 'SYNC_ERROR';
    const message = err?.message ?? 'Unknown sync error';
    await updateShipmentError(shipment.id, code, message);

    return {
      ok: false,
      shipmentId: shipment.id,
      error: message,
      errorCode: code,
    };
  }
}

export async function registerShipment(params: {
  trackingNumber: string;
  carrier?: CarrierCode;
  sourceSystem?: string;
}) {
  const normalized = normalizeTrackingNumber(params.trackingNumber);
  if (!normalized) throw new Error('Invalid tracking number');

  const carrier = params.carrier ?? detectCarrier(normalized);
  if (!carrier) throw new Error(`Cannot detect carrier for: ${normalized}`);

  return upsertShipment({
    trackingNumberRaw: params.trackingNumber,
    trackingNumberNormalized: normalized,
    carrier,
    sourceSystem: params.sourceSystem,
  });
}

export async function registerAndSyncShipment(params: {
  trackingNumber: string;
  carrier?: CarrierCode;
  sourceSystem?: string;
}) {
  const shipment = await registerShipment(params);

  if (!shipment.last_checked_at && !shipment.latest_status_category) {
    await syncShipment({ shipmentId: shipment.id });
  }

  return shipment;
}
