/**
 * Phase G — observability for carrier tracking / receiving-delivered health.
 *
 * G1: collect one structured snapshot of the numbers that tell us whether the
 *     delivered surface is honest — delivered-unscanned, per-carrier delivered
 *     throughput, TRACKING_UNAVAILABLE (blocked) counts, error-stuck shipments,
 *     and unmatched-tracking (receiving rows with a tracking# but no STN link).
 * G2: derive alerts from that snapshot — USPS access still blocked (IP-Agreement
 *     reminder), a backlog of error-stuck shipments, or a carrier that has live
 *     in-transit volume but zero delivered detections over a week (a likely sign
 *     a carrier introduced a status code our maps don't catch — see R3).
 *
 * Pure reads. The cron logs the snapshot (`[metrics.shipping.tracking]`) and any
 * alerts (`[alert.shipping.tracking]`) as structured lines the log scrapers key
 * off — the codebase's established "alert" channel (no Slack integration here).
 */
import pool from '@/lib/db';
import { getDeliveredUnscannedCount } from '@/lib/receiving/delivered-unscanned';

export interface CarrierThroughput {
  carrier: 'UPS' | 'USPS' | 'FEDEX';
  active: number;          // non-terminal shipments we still poll
  inTransitOrOfd: number;  // live, moving
  delivered7d: number;     // delivered in the last 7 days
  blocked: number;         // access-blocked, not delivered
  errorStuck: number;      // consecutive_error_count >= 5, non-terminal
}

export interface ShippingTrackingMetrics {
  deliveredUnscanned: number;
  blockedTotal: number;
  uspsBlocked: number;
  pendingStatus: number;     // registered, carrier returned no status yet
  errorStuckTotal: number;
  outForDelivery: number;
  inTransit: number;
  openReceivingExceptions: number;
  unmatchedTracking: number; // receiving rows w/ tracking# but no shipment_id (90d)
  perCarrier: CarrierThroughput[];
}

export interface MetricAlert {
  level: 'warn' | 'error';
  code: string;
  message: string;
  value: number;
}

/** Carrier active-volume floor before a zero-delivered week counts as a signal. */
const DETECTION_VOLUME_FLOOR = Number(process.env.SHIPPING_DETECTION_VOLUME_FLOOR || 20);
/** error-stuck backlog size that warrants a warning. */
const ERROR_STUCK_WARN = Number(process.env.SHIPPING_ERROR_STUCK_WARN || 250);

const CARRIERS: Array<'UPS' | 'USPS' | 'FEDEX'> = ['UPS', 'USPS', 'FEDEX'];

export async function collectShippingTrackingMetrics(): Promise<ShippingTrackingMetrics> {
  const stn = await pool.query<{
    blocked_total: number; usps_blocked: number; pending_status: number;
    error_stuck_total: number; out_for_delivery: number; in_transit: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE tracking_blocked_reason IS NOT NULL AND COALESCE(is_delivered,false)=false)::int                                   AS blocked_total,
       count(*) FILTER (WHERE tracking_blocked_reason IS NOT NULL AND COALESCE(is_delivered,false)=false AND carrier='USPS')::int                AS usps_blocked,
       count(*) FILTER (WHERE COALESCE(is_terminal,false)=false AND carrier IN ('UPS','USPS','FEDEX')
                              AND (latest_status_category IS NULL OR latest_status_category='UNKNOWN')
                              AND tracking_blocked_reason IS NULL)::int                                                                            AS pending_status,
       count(*) FILTER (WHERE COALESCE(is_terminal,false)=false AND consecutive_error_count >= 5 AND carrier IN ('UPS','USPS','FEDEX'))::int      AS error_stuck_total,
       count(*) FILTER (WHERE is_out_for_delivery AND COALESCE(is_delivered,false)=false)::int                                                    AS out_for_delivery,
       count(*) FILTER (WHERE is_in_transit AND COALESCE(is_delivered,false)=false AND COALESCE(is_out_for_delivery,false)=false)::int           AS in_transit
     FROM shipping_tracking_numbers`,
  );

  const perCarrierRows = await pool.query<{
    carrier: 'UPS' | 'USPS' | 'FEDEX';
    active: number; in_transit_or_ofd: number; delivered_7d: number; blocked: number; error_stuck: number;
  }>(
    `SELECT carrier,
            count(*) FILTER (WHERE COALESCE(is_terminal,false)=false)::int                                                       AS active,
            count(*) FILTER (WHERE (is_in_transit OR is_out_for_delivery) AND COALESCE(is_delivered,false)=false)::int           AS in_transit_or_ofd,
            count(*) FILTER (WHERE is_delivered AND delivered_at > now() - interval '7 days')::int                               AS delivered_7d,
            count(*) FILTER (WHERE tracking_blocked_reason IS NOT NULL AND COALESCE(is_delivered,false)=false)::int              AS blocked,
            count(*) FILTER (WHERE COALESCE(is_terminal,false)=false AND consecutive_error_count >= 5)::int                      AS error_stuck
       FROM shipping_tracking_numbers
      WHERE carrier IN ('UPS','USPS','FEDEX')
      GROUP BY carrier`,
  );
  const byCarrier = new Map(perCarrierRows.rows.map((r) => [r.carrier, r]));

  const exceptions = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM tracking_exceptions WHERE domain='receiving' AND status='open'`,
  );

  const unmatched = await pool.query<{ n: number }>(
    // Recent intake cartons with no canonical STN link. Tracking now lives only
    // in shipping_tracking_numbers (via shipment_id), so "unmatched" = an
    // unmatched-source carton that never got an STN row.
    `SELECT count(*)::int AS n FROM receiving r
      WHERE r.shipment_id IS NULL
        AND r.source = 'unmatched'
        AND r.created_at > now() - interval '90 days'`,
  );

  const deliveredUnscanned = await getDeliveredUnscannedCount(pool);
  const s = stn.rows[0];

  return {
    deliveredUnscanned,
    blockedTotal: s?.blocked_total ?? 0,
    uspsBlocked: s?.usps_blocked ?? 0,
    pendingStatus: s?.pending_status ?? 0,
    errorStuckTotal: s?.error_stuck_total ?? 0,
    outForDelivery: s?.out_for_delivery ?? 0,
    inTransit: s?.in_transit ?? 0,
    openReceivingExceptions: exceptions.rows[0]?.n ?? 0,
    unmatchedTracking: unmatched.rows[0]?.n ?? 0,
    perCarrier: CARRIERS.map((carrier) => {
      const r = byCarrier.get(carrier);
      return {
        carrier,
        active: r?.active ?? 0,
        inTransitOrOfd: r?.in_transit_or_ofd ?? 0,
        delivered7d: r?.delivered_7d ?? 0,
        blocked: r?.blocked ?? 0,
        errorStuck: r?.error_stuck ?? 0,
      };
    }),
  };
}

/** G2 — derive alerts from a snapshot. Empty array = healthy. */
export function detectMetricAlerts(m: ShippingTrackingMetrics): MetricAlert[] {
  const alerts: MetricAlert[] = [];

  if (m.uspsBlocked > 0) {
    alerts.push({
      level: 'warn',
      code: 'USPS_ACCESS_BLOCKED',
      message: `${m.uspsBlocked} USPS shipment(s) blocked on tracking access — IP Agreement still pending; USPS delivered status is unobtainable.`,
      value: m.uspsBlocked,
    });
  }

  if (m.errorStuckTotal >= ERROR_STUCK_WARN) {
    alerts.push({
      level: 'warn',
      code: 'ERROR_STUCK_BACKLOG',
      message: `${m.errorStuckTotal} shipments stuck at consecutive_error_count>=5 — reconcile retries them at 1/12h; investigate if persistently high.`,
      value: m.errorStuckTotal,
    });
  }

  // Detection-rate-drop proxy: a carrier with real live volume but zero
  // delivered detections in a week likely means a status code stopped mapping.
  for (const c of m.perCarrier) {
    if (c.carrier === 'USPS') continue; // USPS is access-blocked by design — skip
    if (c.inTransitOrOfd >= DETECTION_VOLUME_FLOOR && c.delivered7d === 0) {
      alerts.push({
        level: 'error',
        code: 'DELIVERED_DETECTION_ZERO',
        message: `${c.carrier}: ${c.inTransitOrOfd} live shipments but 0 delivered in 7d — possible unmapped carrier status code (R3).`,
        value: c.inTransitOrOfd,
      });
    }
  }

  return alerts;
}
