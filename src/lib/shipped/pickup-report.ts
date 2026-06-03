/**
 * Daily carrier shipped-report aggregation.
 *
 * Turns a day's shipped records into the per-carrier summary the warehouse
 * prints for the carrier hand-off log: how many tracking numbers and how many
 * customer vs FBA orders went out on each carrier that day. The physical
 * "checked by" / notes fields are filled in by hand on the printout, so they
 * are intentionally not computed here.
 *
 * Carrier resolution: the DB `carrier` (from shipping_tracking_numbers) wins
 * when present; otherwise we detect it from the tracking-number prefix using
 * the shared {@link detectCarrierFromTracking}. Rows that resolve to neither —
 * SKU/item-number scans, label-print URL scans, FNSKUs, raw 2D-barcode dumps —
 * are not carrier shipments and are dropped, so there is no "Other"/"no carrier"
 * bucket.
 *
 * Pure and UI-agnostic: it takes a minimal record shape (a structural subset of
 * PackerRecord / ShippedOrder) so it can be unit-tested and called from either
 * the in-memory table rows or a freshly-fetched day.
 */

import { detectCarrierFromTracking, toDisplayCarrier } from '@/utils/carrier-patterns';

/** Structural subset of a shipped record this report needs. */
export interface PickupRecordInput {
  order_id?: string | null;
  scan_ref?: string | null;
  tracking_type?: string | null;
  shipping_tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  carrier?: string | null;
}

export interface PickupReportRow {
  /** Display carrier label, e.g. "UPS", "USPS", "FedEx", "DHL". */
  carrier: string;
  trackingNumbers: number;
  customerOrders: number;
  fbaOrders: number;
}

export interface PickupReportData {
  /** PST date key (yyyy-mm-dd) this report covers. */
  dateKey: string;
  /** UPS / USPS / FedEx always present; any other resolved carrier appended. */
  rows: PickupReportRow[];
  /** Column totals across every carrier. */
  totals: { trackingNumbers: number; customerOrders: number; fbaOrders: number };
}

/** Carriers that always get a row, in print order, even when zero. */
const PRIMARY_CARRIERS = ['UPS', 'USPS', 'FedEx'] as const;

const FBA_SHIPMENT_ID_RE = /^FBA[0-9A-Z]{8,}$/i;

/** Mirror of DashboardShippedTable's FBA classifier so counts match the tab. */
function isFbaRecord(record: PickupRecordInput): boolean {
  const scanRef = String(record.scan_ref || '').trim();
  const ttype = String(record.tracking_type || '').toUpperCase();
  return FBA_SHIPMENT_ID_RE.test(scanRef) || ttype === 'FBA' || ttype === 'FNSKU';
}

function normalize(raw: string | null | undefined): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Map a stored DB carrier string to a display label, or null if unrecognized. */
function recognizedDbCarrier(raw: string | null | undefined): string | null {
  const c = normalize(raw);
  if (!c) return null;
  if (c.includes('USPS') || c.includes('UNITEDSTATESPOSTAL')) return 'USPS';
  if (c.includes('UPS')) return 'UPS';
  if (c.includes('FEDEX')) return 'FedEx';
  if (c.includes('DHL')) return 'DHL';
  if (c.includes('AMAZON') || c === 'AMZL') return 'Amazon';
  if (c.includes('ONTRAC')) return 'OnTrac';
  if (c.includes('LASERSHIP')) return 'LaserShip';
  if (c.includes('GSO')) return 'GSO';
  return null;
}

/** All candidate tracking strings for a record, real tracking numbers first. */
function trackingCandidates(record: PickupRecordInput): string[] {
  const list = Array.isArray(record.tracking_numbers) ? record.tracking_numbers : [];
  return [...list, record.shipping_tracking_number].map((t) => String(t || '').trim()).filter(Boolean);
}

/**
 * Resolve a record's carrier: DB value first, then tracking-number prefix.
 * Returns null when the row is not a carrier shipment (no carrier, no tracking
 * that matches a known carrier format).
 */
function resolveCarrier(record: PickupRecordInput): string | null {
  const db = recognizedDbCarrier(record.carrier);
  if (db) return db;
  for (const candidate of trackingCandidates(record)) {
    const code = detectCarrierFromTracking(candidate);
    if (code) return toDisplayCarrier(code);
  }
  return null;
}

/** Stable identity for de-duplicating records (matches the table's dedup key). */
function recordKey(record: PickupRecordInput): string {
  const orderKey = String(record.order_id || '').trim();
  if (orderKey) return `o:${orderKey}`;
  const t = String(record.shipping_tracking_number || record.scan_ref || '').trim();
  return t ? `t:${t}` : '';
}

interface CarrierAccumulator {
  trackingNumbers: Set<string>;
  customerOrders: number;
  fbaOrders: number;
}

function emptyAcc(): CarrierAccumulator {
  return { trackingNumbers: new Set(), customerOrders: 0, fbaOrders: 0 };
}

/**
 * Aggregate one day's shipped records into the carrier report. De-duplicates
 * the records (the same way the Shipped table does), resolves each row's
 * carrier (DB then tracking prefix), and drops rows that aren't carrier
 * shipments. Tracking numbers are counted distinct per carrier; orders are
 * split into customer vs FBA.
 */
export function aggregatePickupReport(
  records: PickupRecordInput[],
  dateKey: string,
): PickupReportData {
  const buckets = new Map<string, CarrierAccumulator>();
  const bucket = (carrier: string): CarrierAccumulator => {
    let acc = buckets.get(carrier);
    if (!acc) {
      acc = emptyAcc();
      buckets.set(carrier, acc);
    }
    return acc;
  };
  // Seed the primary carriers so they always print, even at zero.
  for (const c of PRIMARY_CARRIERS) bucket(c);

  const seen = new Set<string>();
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const key = recordKey(record) || `i:${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const carrier = resolveCarrier(record);
    if (!carrier) continue; // not a carrier shipment — skip

    const acc = bucket(carrier);
    for (const t of trackingCandidates(record)) acc.trackingNumbers.add(t);
    if (isFbaRecord(record)) acc.fbaOrders += 1;
    else acc.customerOrders += 1;
  }

  // Primary carriers in fixed order, then any extras sorted by volume desc.
  const extras = [...buckets.keys()]
    .filter((c) => !PRIMARY_CARRIERS.includes(c as (typeof PRIMARY_CARRIERS)[number]))
    .sort((a, b) => {
      const av = buckets.get(a)!;
      const bv = buckets.get(b)!;
      return (
        bv.trackingNumbers.size + bv.customerOrders + bv.fbaOrders
        - (av.trackingNumbers.size + av.customerOrders + av.fbaOrders)
      );
    });

  const rows: PickupReportRow[] = [...PRIMARY_CARRIERS, ...extras].map((carrier) => {
    const acc = buckets.get(carrier)!;
    return {
      carrier,
      trackingNumbers: acc.trackingNumbers.size,
      customerOrders: acc.customerOrders,
      fbaOrders: acc.fbaOrders,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      trackingNumbers: acc.trackingNumbers + r.trackingNumbers,
      customerOrders: acc.customerOrders + r.customerOrders,
      fbaOrders: acc.fbaOrders + r.fbaOrders,
    }),
    { trackingNumbers: 0, customerOrders: 0, fbaOrders: 0 },
  );

  return { dateKey, rows, totals };
}
