/**
 * Normalized shipping-engine domain contract.
 *
 * The app talks to a label-buying carrier engine (ShipStation v2 / ShipEngine)
 * ONLY through these normalized shapes — the raw provider JSON is mapped into
 * them inside `client.ts` and never leaks past the lib boundary. Endpoints and
 * UI consume these dumb, presentation-ready shapes ("format in lib, render
 * dumb"; see .claude/rules/source-of-truth.md).
 *
 * These types are provider-agnostic on purpose: if the engine is ever swapped
 * (or a second engine added), only the mapping in `client.ts` changes, not the
 * endpoints, the UI, or the shipment/document plumbing they feed.
 */

/** A postal address in the engine's neutral shape. Built from the order's
 *  customer (ship-to) or the org's warehouse (ship-from). */
export interface ShipAddress {
  name: string;
  phone?: string | null;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  /** ISO-3166 alpha-2 (e.g. 'US'). */
  countryCode: string;
  /** true → residential, false → commercial, null → let the carrier decide. */
  residential?: boolean | null;
}

export type WeightUnit = 'ounce' | 'pound' | 'gram' | 'kilogram';
export type DimensionUnit = 'inch' | 'centimeter';

/** One physical parcel to rate/label. Weight is required by every carrier;
 *  dimensions are optional but sharpen the quote (dim-weight). */
export interface Parcel {
  weight: { value: number; unit: WeightUnit };
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: DimensionUnit;
  } | null;
}

/** Everything needed to ask the engine for rates or to buy a label. Assembled
 *  server-side from the order + customer + org warehouse + (ShipStation-stored)
 *  parcel weight. */
export interface ShipmentSpec {
  shipTo: ShipAddress;
  shipFrom: ShipAddress;
  parcels: Parcel[];
  /** Restrict the quote to specific connected carriers; omit = all connected. */
  carrierIds?: string[];
  /** Signature/adult-signature etc.; engine-neutral pass-through. */
  confirmation?: 'none' | 'delivery' | 'signature' | 'adult_signature' | null;
  /** Declared value for insurance, in the order's currency. */
  insuredValue?: { amount: number; currency: string } | null;
}

/** One purchasable rate option, normalized for the rate-shop UI. `rateId` is the
 *  token the buy-label call quotes back to purchase THIS exact rate. */
export interface ShippingRateOption {
  /** Opaque engine rate id — pass to `purchaseLabelFromRate` to buy this rate. */
  rateId: string;
  carrierId: string;
  /** Machine code, e.g. 'ups' | 'fedex' | 'stamps_com' | 'usps'. */
  carrierCode: string;
  /** Human name, e.g. 'UPS' | 'USPS'. */
  carrierName: string;
  /** Machine service code, e.g. 'usps_priority_mail'. */
  serviceCode: string;
  /** Human service name, e.g. 'USPS Priority Mail'. */
  serviceName: string;
  /** Total shipping cost (base + fees the engine bundled into the shipping
   *  amount) in `currency`. */
  amount: number;
  currency: string;
  /** Insurance + confirmation + other surcharges the engine reported
   *  separately from the shipping amount, when any. */
  otherAmount?: number | null;
  /** Guaranteed/estimated transit days, when the carrier provides it. */
  deliveryDays?: number | null;
  /** ISO date string of the estimated delivery, when provided. */
  estimatedDeliveryDate?: string | null;
  /** Free-text carrier delivery estimate (e.g. '1-3 days') when no numeric
   *  value is available. */
  carrierDeliveryDays?: string | null;
  packageType?: string | null;
  trackable?: boolean;
  /** Non-fatal notes the carrier attached to this rate (e.g. surcharge info). */
  warnings?: string[];
}

/** The normalized result of a rate quote — the shape the /rates endpoint
 *  returns to the rate-shop UI. */
export interface RateQuoteResult {
  rates: ShippingRateOption[];
  /** Carrier/service combinations the engine could not rate, with the reason —
   *  surfaced so the operator understands a gap instead of silence. */
  invalidRates: Array<{
    carrierCode?: string | null;
    serviceCode?: string | null;
    message: string;
  }>;
  /** Engine correlation ids, echoed for support/debugging; never shown raw. */
  rateRequestId?: string | null;
  engineShipmentId?: string | null;
}

/** The label file the engine produced, in whatever formats it returned. At
 *  least one of these is always present; the buy-label route proxies the bytes
 *  into the org's document store so no engine credential is needed to view it. */
export interface LabelDownload {
  pdf?: string | null;
  png?: string | null;
  zpl?: string | null;
  /** Provider href (may require the API key to fetch → proxied server-side). */
  href?: string | null;
}

/** The normalized result of buying a label. Everything the buy-label route needs
 *  to register the STN/tracking, store the label document, and audit. */
export interface LabelPurchaseResult {
  /** Engine label id — needed to void/refund later. */
  labelId: string;
  /** Engine status, e.g. 'completed'. */
  status: string;
  engineShipmentId?: string | null;
  trackingNumber: string;
  carrierCode: string;
  carrierId?: string | null;
  serviceCode?: string | null;
  /** ISO date the label ships. */
  shipDate?: string | null;
  /** What we were actually charged, in `currency`. */
  cost: number;
  currency: string;
  labelDownload: LabelDownload;
}

/** Result of voiding/refunding a label. */
export interface VoidLabelResult {
  approved: boolean;
  message?: string | null;
}

/** A carrier connected in the org's ShipStation account, for carrier filters. */
export interface EngineCarrier {
  carrierId: string;
  carrierCode: string;
  friendlyName: string;
  services: Array<{ serviceCode: string; name: string }>;
}

/** Map a raw label-download format string to a mime type for storage. */
export function labelFormatToMime(format: 'pdf' | 'png' | 'zpl'): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'zpl':
      return 'application/zpl';
  }
}
