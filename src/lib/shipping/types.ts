export type CarrierCode = 'UPS' | 'USPS' | 'FEDEX';

export type NormalizedShipmentStatus =
  | 'LABEL_CREATED'
  | 'ACCEPTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'RETURNED'
  | 'UNKNOWN';

export interface CarrierTrackingEvent {
  externalEventId?: string | null;
  externalStatusCode?: string | null;
  externalStatusLabel?: string | null;
  externalStatusDescription?: string | null;
  normalizedStatusCategory: NormalizedShipmentStatus;
  eventOccurredAt?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  signedBy?: string | null;
  exceptionCode?: string | null;
  exceptionDescription?: string | null;
  payload: unknown;
}

export interface CarrierTrackingResult {
  carrier: CarrierCode;
  trackingNumberNormalized: string;
  latestStatusCategory: NormalizedShipmentStatus;
  latestStatusCode?: string | null;
  latestStatusLabel?: string | null;
  latestStatusDescription?: string | null;
  latestEventAt?: string | null;
  deliveredAt?: string | null;
  events: CarrierTrackingEvent[];
  payload: unknown;
}

export interface ShipmentRow {
  id: number;
  tracking_number_raw: string;
  tracking_number_normalized: string;
  carrier: string;
  carrier_account_ref: string | null;
  source_system: string | null;
  latest_status_code: string | null;
  latest_status_label: string | null;
  latest_status_description: string | null;
  latest_status_category: string | null;
  is_label_created: boolean;
  is_carrier_accepted: boolean;
  is_in_transit: boolean;
  is_out_for_delivery: boolean;
  is_delivered: boolean;
  has_exception: boolean;
  is_terminal: boolean;
  label_created_at: string | null;
  carrier_accepted_at: string | null;
  first_in_transit_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  exception_at: string | null;
  latest_event_at: string | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  check_attempt_count: number;
  consecutive_error_count: number;
  last_error_code: string | null;
  last_error_message: string | null;
  latest_payload: unknown;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface TrackingEventRow {
  id: number;
  shipment_id: number;
  carrier: string;
  tracking_number_normalized: string;
  external_event_id: string | null;
  external_status_code: string | null;
  external_status_label: string | null;
  external_status_description: string | null;
  normalized_status_category: string;
  event_occurred_at: string | null;
  event_recorded_at: string;
  event_city: string | null;
  event_state: string | null;
  event_postal_code: string | null;
  event_country_code: string | null;
  signed_by: string | null;
  exception_code: string | null;
  exception_description: string | null;
  payload: unknown;
  created_at: string;
}
