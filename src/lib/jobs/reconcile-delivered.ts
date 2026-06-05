/**
 * Phase F2 — periodic reconcile guard for carrier delivered-state.
 *
 * The poll path (updateShipmentSummary) is the primary writer, but two failure
 * modes can leave the DB inconsistent between sweeps:
 *
 *   1. A DELIVERED event lands in `shipment_tracking_events` but the summary
 *      write that should set `is_delivered` fails (transient DB error, a crash
 *      mid-sweep). The event log says delivered; the STN flag doesn't. The
 *      shipment may then climb to consecutive_error_count >= 5 and the cron
 *      stops polling it entirely — it silently stays "not delivered" forever.
 *   2. A row hits the consecutive_error_count >= 5 cutoff (a dead label, a
 *      flaky window) and `getDueShipments` permanently skips it.
 *
 * This job runs on a slow cron and:
 *   - re-derives delivered from the event log (idempotent, no carrier calls),
 *     making it monotonic + coherent — the ongoing version of the F1 backfill;
 *   - frees error-stuck rows for one more retry (NOT carrier-blocked ones — those
 *     have a 24h backoff already and would just burn the quota re-failing).
 *
 * Pure SQL, no carrier API calls — cheap and safe to run often.
 */
import pool from '@/lib/db';

export interface ReconcileDeliveredResult {
  ok: boolean;
  /** STN rows flipped to delivered (or had delivered_at filled) from the log. */
  deliveredReconciled: number;
  /** is_delivered=true rows with no delivered_at that got one (coherence A4). */
  coherenceFixed: number;
  /** error-stuck rows freed for one more poll attempt. */
  erroredRecovered: number;
  durationMs: number;
}

/** Hours a row must sit error-stuck before we grant it another retry. */
const ERROR_RETRY_AFTER_HOURS = 12;

export async function runReconcileDeliveredJob(): Promise<ReconcileDeliveredResult> {
  const start = Date.now();
  const client = await pool.connect();
  try {
    // 1. Delivered-from-log: any shipment with a DELIVERED event whose flag is
    //    off (or whose delivered_at is missing) is reconciled to delivered,
    //    monotonic + terminal, earliest event = delivered_at.
    const delivered = await client.query(
      `WITH log AS (
         SELECT e.shipment_id,
                min(e.event_occurred_at) FILTER (WHERE e.normalized_status_category = 'DELIVERED') AS first_delivered_at,
                bool_or(e.normalized_status_category = 'DELIVERED')                                 AS has_delivered
           FROM shipment_tracking_events e
          GROUP BY e.shipment_id
       )
       UPDATE shipping_tracking_numbers stn
          SET is_delivered     = true,
              is_terminal      = true,
              delivered_at     = COALESCE(stn.delivered_at, log.first_delivered_at, now()),
              delivered_source = COALESCE(stn.delivered_source, 'event_log'),
              next_check_at    = NULL,
              updated_at       = now()
         FROM log
        WHERE log.shipment_id = stn.id
          AND log.has_delivered = true
          AND (stn.is_delivered IS DISTINCT FROM true OR stn.delivered_at IS NULL)`,
    );

    // 2. Coherence (A4): delivered rows with NO delivered event in the log and a
    //    NULL delivered_at — fall back to latest_event_at, else now().
    const coherence = await client.query(
      `UPDATE shipping_tracking_numbers stn
          SET delivered_at     = COALESCE(stn.latest_event_at, now()),
              delivered_source = COALESCE(stn.delivered_source, 'latest'),
              is_terminal      = true,
              updated_at       = now()
        WHERE stn.is_delivered = true
          AND stn.delivered_at IS NULL`,
    );

    // 3. Free error-stuck rows for one more attempt. Skip carrier-blocked rows
    //    (tracking_blocked_reason set → 24h backoff already; retrying just
    //    re-hits the access wall) and terminal rows.
    const recovered = await client.query(
      `UPDATE shipping_tracking_numbers
          SET consecutive_error_count = 0,
              next_check_at           = now(),
              updated_at              = now()
        WHERE is_terminal = false
          AND consecutive_error_count >= 5
          AND tracking_blocked_reason IS NULL
          AND carrier IN ('UPS','USPS','FEDEX')
          AND (last_checked_at IS NULL OR last_checked_at < now() - ($1 || ' hours')::interval)`,
      [String(ERROR_RETRY_AFTER_HOURS)],
    );

    return {
      ok: true,
      deliveredReconciled: delivered.rowCount ?? 0,
      coherenceFixed: coherence.rowCount ?? 0,
      erroredRecovered: recovered.rowCount ?? 0,
      durationMs: Date.now() - start,
    };
  } finally {
    client.release();
  }
}
