/** Facet bucket — mirrors the SQL CASE in /api/receiving-lines view=incoming. */
export type IncomingDeliveryState =
  | 'DELIVERED_UNOPENED'
  | 'DELIVERED_NOT_UNBOXED'
  | 'DELIVERED_EMAIL'
  | 'ARRIVING_TODAY'
  | 'STALLED'
  | 'IN_TRANSIT'
  | 'TRACKING_UNAVAILABLE'
  | 'PENDING_CARRIER'
  | 'CARRIER_MISMATCH'
  | 'AWAITING_TRACKING'
  | 'WRONG_DESTINATION';

export interface IncomingCarrierBreakdown {
  carrier: 'UPS' | 'USPS' | 'FEDEX' | 'UNKNOWN' | string;
  delivered_unscanned: number;
  tracking_unavailable: number;
  in_transit: number;
  carrier_mismatch: number;
}

export interface IncomingSummary {
  issued: number;
  delivered_unopened: number;
  delivered_not_unboxed: number;
  delivered_email: number;
  arriving_today: number;
  stalled: number;
  in_transit: number;
  pending_carrier: number;
  carrier_mismatch: number;
  tracking_unavailable: number;
  awaiting_tracking: number;
  expected_today: number;
  wrong_destination?: number;
  by_carrier?: IncomingCarrierBreakdown[];
}
