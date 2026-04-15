import pool from '../db';
import type { CarrierCode, CarrierTrackingEvent, CarrierTrackingResult, ShipmentRow, TrackingEventRow } from './types';
import { computeNextCheckAt, normalizeTrackingNumber } from './normalize';

// ─── Upsert shipment master record ───────────────────────────────────────────

export async function upsertShipment(params: {
  trackingNumberRaw: string;
  trackingNumberNormalized: string;
  carrier: CarrierCode;
  sourceSystem?: string | null;
  carrierAccountRef?: string | null;
}): Promise<ShipmentRow> {
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system, carrier_account_ref, next_check_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET carrier_account_ref = EXCLUDED.carrier_account_ref,
             source_system       = COALESCE(EXCLUDED.source_system, shipping_tracking_numbers.source_system),
             updated_at          = now()
       RETURNING *`,
      [
        params.trackingNumberRaw,
        params.trackingNumberNormalized,
        params.carrier,
        params.sourceSystem ?? null,
        params.carrierAccountRef ?? null,
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

export async function getShipmentById(id: number): Promise<ShipmentRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(
      'SELECT * FROM shipping_tracking_numbers WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function getShipmentByTracking(
  trackingNumberNormalized: string
): Promise<ShipmentRow | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<ShipmentRow>(
      'SELECT * FROM shipping_tracking_numbers WHERE tracking_number_normalized = $1',
      [normalizeTrackingNumber(trackingNumberNormalized)]
    );
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function getDueShipments(
  limit: number = 50,
  carriers?: CarrierCode[]
): Promise<ShipmentRow[]> {
  const client = await pool.connect();
  try {
    const params: Array<number | string[]> = [];
    const where: string[] = [
      `is_terminal = false`,
      `(next_check_at IS NULL OR next_check_at <= now())`,
      // Never try to sync UNKNOWN carrier — no API to call
      `carrier IN ('UPS','USPS','FEDEX')`,
      // Stop retrying after 5 consecutive failures (dead tracking numbers)
      `consecutive_error_count < 5`,
    ];

    if (carriers && carriers.length > 0) {
      params.push(carriers);
      where.push(`carrier = ANY($${params.length}::text[])`);
    }

    // Prioritize shipments that are actually in-flight over label-only
    params.push(limit);

    const result = await client.query<ShipmentRow>(
      `SELECT * FROM shipping_tracking_numbers
       WHERE ${where.join('\n         AND ')}
       ORDER BY
         CASE WHEN is_in_transit OR is_out_for_delivery THEN 0
              WHEN is_carrier_accepted THEN 1
              ELSE 2 END,
         next_check_at ASC NULLS FIRST
       LIMIT $${params.length}`,
      params
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function getShipmentEvents(shipmentId: number): Promise<TrackingEventRow[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<TrackingEventRow>(
      `SELECT * FROM shipment_tracking_events
       WHERE shipment_id = $1
       ORDER BY event_occurred_at DESC NULLS LAST, id DESC`,
      [shipmentId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

// ─── Upsert carrier events (deduped via unique index) ────────────────────────

export async function upsertTrackingEvents(
  shipmentId: number,
  carrier: CarrierCode,
  trackingNumberNormalized: string,
  events: CarrierTrackingEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  const client = await pool.connect();
  try {
    let inserted = 0;
    for (const ev of events) {
      const result = await client.query(
        `INSERT INTO shipment_tracking_events (
           shipment_id, carrier, tracking_number_normalized,
           external_event_id, external_status_code, external_status_label,
           external_status_description, normalized_status_category,
           event_occurred_at, event_city, event_state, event_postal_code,
           event_country_code, signed_by, exception_code, exception_description,
           payload
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
         )
         ON CONFLICT (
           shipment_id,
           COALESCE(external_event_id, ''),
           COALESCE(external_status_code, ''),
           COALESCE(event_occurred_at, 'epoch'::timestamptz)
         ) DO NOTHING`,
        [
          shipmentId,
          carrier,
          trackingNumberNormalized,
          ev.externalEventId ?? null,
          ev.externalStatusCode ?? null,
          ev.externalStatusLabel ?? null,
          ev.externalStatusDescription ?? null,
          ev.normalizedStatusCategory,
          ev.eventOccurredAt ?? null,
          ev.city ?? null,
          ev.state ?? null,
          ev.postalCode ?? null,
          ev.countryCode ?? null,
          ev.signedBy ?? null,
          ev.exceptionCode ?? null,
          ev.exceptionDescription ?? null,
          JSON.stringify(ev.payload ?? {}),
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted++;
    }
    return inserted;
  } finally {
    client.release();
  }
}

// ─── Update shipment after a successful sync ──────────────────────────────────

export async function updateShipmentSummary(
  shipmentId: number,
  result: CarrierTrackingResult
): Promise<void> {
  const { emitShippedLedgerForShipment } = await import('@/lib/neon/stock-ledger-helpers');
  const client = await pool.connect();
  try {
    const status = result.latestStatusCategory;
    const isTerminal = status === 'DELIVERED' || status === 'RETURNED';
    const nextCheck = isTerminal ? null : computeNextCheckAt(status, 0);

    await client.query(
      `UPDATE shipping_tracking_numbers SET
         latest_status_code        = $1,
         latest_status_label       = $2,
         latest_status_description = $3,
         latest_status_category    = $4,

         is_label_created     = (is_label_created    OR $5::boolean),
         is_carrier_accepted  = (is_carrier_accepted OR $6::boolean),
         is_in_transit        = (is_in_transit        OR $7::boolean),
         is_out_for_delivery  = (is_out_for_delivery  OR $8::boolean),
         is_delivered         = $9::boolean,
         has_exception        = $10::boolean,
         is_terminal          = $11::boolean,

         label_created_at    = CASE WHEN $12::boolean AND label_created_at IS NULL    THEN now() ELSE label_created_at    END,
         carrier_accepted_at = CASE WHEN $13::boolean AND carrier_accepted_at IS NULL THEN now() ELSE carrier_accepted_at END,
         first_in_transit_at = CASE WHEN $14::boolean AND first_in_transit_at IS NULL THEN now() ELSE first_in_transit_at END,
         out_for_delivery_at = CASE WHEN $15::boolean THEN now() ELSE out_for_delivery_at END,
         delivered_at        = CASE WHEN $16::boolean AND delivered_at IS NULL THEN COALESCE($17::timestamptz, now()) ELSE delivered_at END,
         exception_at        = CASE WHEN $18::boolean THEN now() ELSE exception_at END,

         latest_event_at          = COALESCE($19::timestamptz, latest_event_at),
         last_checked_at          = now(),
         next_check_at            = $20::timestamptz,
         check_attempt_count      = check_attempt_count + 1,
         consecutive_error_count  = 0,
         last_error_code          = NULL,
         last_error_message       = NULL,
         latest_payload           = $21::jsonb,
         metadata                 = COALESCE(metadata, '{}'::jsonb) || $22::jsonb,
         updated_at               = now()
       WHERE id = $23`,
      [
        result.latestStatusCode ?? null,               // $1
        result.latestStatusLabel ?? null,              // $2
        result.latestStatusDescription ?? null,        // $3
        status,                                        // $4

        status === 'LABEL_CREATED',                    // $5  is_label_created
        status === 'ACCEPTED',                         // $6  is_carrier_accepted
        status === 'IN_TRANSIT',                       // $7  is_in_transit
        status === 'OUT_FOR_DELIVERY',                 // $8  is_out_for_delivery
        status === 'DELIVERED',                        // $9  is_delivered
        status === 'EXCEPTION',                        // $10 has_exception
        isTerminal,                                    // $11 is_terminal

        status === 'LABEL_CREATED',                    // $12 label_created_at gate
        status === 'ACCEPTED',                         // $13 carrier_accepted_at gate
        status === 'IN_TRANSIT',                       // $14 first_in_transit_at gate
        status === 'OUT_FOR_DELIVERY',                 // $15 out_for_delivery_at gate
        status === 'DELIVERED',                        // $16 delivered_at gate
        result.deliveredAt ?? null,                    // $17 delivered_at value
        status === 'EXCEPTION',                        // $18 exception_at gate

        result.latestEventAt ?? null,                  // $19
        nextCheck?.toISOString() ?? null,              // $20
        JSON.stringify(result.payload ?? {}),          // $21
        JSON.stringify(result.metadata ?? {}),         // $22
        shipmentId,                                    // $23
      ]
    );

    // If carrier just accepted the package, drain boxed_stock for this
    // shipment. Idempotent: helper skips if a SHIPPED row already exists
    // for this shipment_id.
    if (
      status === 'ACCEPTED' ||
      status === 'IN_TRANSIT' ||
      status === 'OUT_FOR_DELIVERY' ||
      status === 'DELIVERED'
    ) {
      try {
        await emitShippedLedgerForShipment(client, shipmentId, {
          source: `carrier-sync.${status}`,
        });
      } catch (err) {
        console.warn('[updateShipmentSummary] SHIPPED ledger emit failed', err);
      }
    }
  } finally {
    client.release();
  }
}

// ─── Update shipment after a failed sync ─────────────────────────────────────

export async function updateShipmentError(
  shipmentId: number,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE shipping_tracking_numbers SET
         consecutive_error_count = consecutive_error_count + 1,
         check_attempt_count     = check_attempt_count + 1,
         last_checked_at         = now(),
         last_error_code         = $1,
         last_error_message      = $2,
         next_check_at           = now() + (
           INTERVAL '1 hour' * LEAST(POWER(2, consecutive_error_count), 16)
         ),
         updated_at              = now()
       WHERE id = $3`,
      [errorCode, errorMessage.slice(0, 1000), shipmentId]
    );
  } finally {
    client.release();
  }
}
