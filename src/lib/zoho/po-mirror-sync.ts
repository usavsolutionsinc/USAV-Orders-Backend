/**
 * zoho_po_mirror sync — pulls Zoho Inventory purchase orders and UPSERTs
 * them into the local mirror table. Used exclusively by the email
 * reconciler; does NOT touch receiving_lines or any other workflow table.
 *
 * Why separate from src/lib/zoho-receiving-sync.ts:
 *   The receiving sync materializes PO line items into the warehouse's
 *   inbound workflow (EXPECTED → ARRIVED → ...). Polling every PO indis-
 *   criminately would pollute operator queues with closed/cancelled/drop-
 *   shipped POs. This mirror exists purely so the reconciler can answer
 *   "does Zoho know about PO #X?" without surfacing anything to operators.
 *
 * Two modes:
 *   - delta: passes last_modified_time so Zoho returns only changed POs
 *   - full:  no filter; bring everything (used by nightly safety net)
 *
 * Both paginate via `paginateZohoList` (200 per page). One DB UPSERT per
 * PO header. Returns a SyncReport with counts + timing.
 */

import pool from '@/lib/db';
import { paginateZohoList, getPurchaseOrderById } from '@/lib/zoho';
import type { ZohoPurchaseOrder } from '@/lib/zoho';

export interface SyncReport {
  mode: 'delta' | 'full';
  pages: number;
  fetched: number;
  upserted: number;
  errors: string[];
  elapsedMs: number;
}

export interface SyncOptions {
  mode: 'delta' | 'full';
  /** ISO8601 with Zoho-friendly offset (formatApiOffsetTimestamp). Only used for delta mode. */
  lastModifiedTime?: string;
  /** Soft caps so a runaway sync can't blow the function timeout. */
  maxPages?: number;
  maxItems?: number;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Zoho's date fields come as 'YYYY-MM-DD' strings. Pass them through as-is
 * — Postgres' DATE column parses them. Empty/invalid → NULL.
 */
function asDateString(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  // Cheap shape guard; the DB will reject anything truly malformed.
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Zoho's `last_modified_time` is an offset timestamp like
 * "2026-05-21T15:38:12-0700". Postgres accepts it natively as
 * TIMESTAMPTZ. Empty → NULL.
 */
function asTimestamptz(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  // Trust Zoho's shape; the DB will reject anything malformed.
  return s;
}

async function upsertOne(po: ZohoPurchaseOrder): Promise<boolean> {
  const id = asString(po.purchaseorder_id);
  const number = asString(po.purchaseorder_number);
  if (!id || !number) return false; // skip rows missing identity

  await pool.query(
    `INSERT INTO zoho_po_mirror
       (zoho_purchaseorder_id, zoho_purchaseorder_number, vendor_id, vendor_name,
        status, po_date, expected_delivery_date, reference_number, total, currency,
        raw, last_modified_zoho, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
     ON CONFLICT (zoho_purchaseorder_id) DO UPDATE
       SET zoho_purchaseorder_number = EXCLUDED.zoho_purchaseorder_number,
           vendor_id                 = EXCLUDED.vendor_id,
           vendor_name               = EXCLUDED.vendor_name,
           status                    = EXCLUDED.status,
           po_date                   = EXCLUDED.po_date,
           expected_delivery_date    = EXCLUDED.expected_delivery_date,
           reference_number          = EXCLUDED.reference_number,
           total                     = EXCLUDED.total,
           currency                  = EXCLUDED.currency,
           raw                       = EXCLUDED.raw,
           last_modified_zoho        = EXCLUDED.last_modified_zoho,
           last_synced_at            = NOW()`,
    [
      id,
      number,
      asString(po.vendor_id),
      asString(po.vendor_name),
      asString(po.status),
      asDateString(po.date),
      asDateString(po.expected_delivery_date),
      asString(po.reference_number),
      asNumber(po.total),
      asString(po.currency_code),
      JSON.stringify(po),
      asTimestamptz((po as unknown as Record<string, unknown>).last_modified_time),
    ],
  );
  return true;
}

/**
 * Refresh a single PO in the mirror by id — fetches the full PO header from
 * Zoho and UPSERTs it. Powers the Incoming details panel's per-order "Sync"
 * button: an operator who suspects one PO is stale can re-pull just that one
 * without running the whole delta sweep. Returns whether the PO was found +
 * its fresh Zoho status (so the caller can tell the operator "now received").
 */
export async function syncOnePoMirror(
  zohoPurchaseOrderId: string,
): Promise<{ found: boolean; status: string | null }> {
  const id = (zohoPurchaseOrderId || '').trim();
  if (!id) return { found: false, status: null };
  const res = await getPurchaseOrderById(id);
  const po = res?.purchaseorder;
  if (!po) return { found: false, status: null };
  const ok = await upsertOne(po);
  return { found: ok, status: asString(po.status) };
}

export async function syncZohoPoMirror(opts: SyncOptions): Promise<SyncReport> {
  const start = Date.now();
  const report: SyncReport = {
    mode: opts.mode,
    pages: 0,
    fetched: 0,
    upserted: 0,
    errors: [],
    elapsedMs: 0,
  };

  const params: Record<string, string> = {};
  if (opts.mode === 'delta' && opts.lastModifiedTime) {
    params.last_modified_time = opts.lastModifiedTime;
  }

  const maxPages = opts.maxPages ?? 200;
  const maxItems = opts.maxItems ?? 20000;

  try {
    for await (const page of paginateZohoList<ZohoPurchaseOrder>(
      '/api/v1/purchaseorders',
      'purchaseorders',
      params,
    )) {
      report.pages += 1;
      for (const po of page) {
        if (report.fetched >= maxItems) break;
        report.fetched += 1;
        try {
          if (await upsertOne(po)) report.upserted += 1;
        } catch (err) {
          const id = (po as { purchaseorder_id?: string }).purchaseorder_id ?? '(unknown)';
          report.errors.push(`po ${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (report.fetched >= maxItems) break;
      if (report.pages >= maxPages) break;
    }
  } catch (err) {
    report.errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  report.elapsedMs = Date.now() - start;
  return report;
}
