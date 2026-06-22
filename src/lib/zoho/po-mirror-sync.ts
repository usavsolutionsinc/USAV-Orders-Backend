/**
 * zoho_po_mirror sync — pulls Zoho Inventory purchase orders and UPSERTs
 * them into the local mirror table (email reconciler + Incoming status
 * source). After the upsert pass it runs ONE follow-up write against
 * receiving_lines: reconcileZohoReceivedLines marks door-scanned lines
 * received when Zoho now reports their PO received/billed/closed, so they
 * drop off the triage SCANNED/Prioritize queue. That is the only workflow
 * write this sync performs.
 *
 * Why separate from src/lib/zoho-receiving-sync.ts:
 *   The receiving sync materializes PO line items into the warehouse's
 *   inbound workflow (EXPECTED → ARRIVED → ...). Polling every PO indis-
 *   criminately would pollute operator queues with closed/cancelled/drop-
 *   shipped POs. This mirror exists so the reconciler can answer
 *   "does Zoho know about PO #X?" without surfacing anything to operators.
 *
 * Two modes:
 *   - delta: passes last_modified_time so Zoho returns only changed POs
 *   - full:  no filter; bring everything (used by nightly safety net)
 *
 * Both paginate via `paginateZohoList` (200 per page). One DB UPSERT per
 * PO header. Returns a SyncReport with counts + timing.
 */

import { paginateZohoList, getPurchaseOrderById } from '@/lib/zoho';
import type { ZohoPurchaseOrder } from '@/lib/zoho';
import { reconcileZohoReceivedLines } from '@/lib/receiving/zoho-received-reconcile';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { withZohoCredential } from '@/lib/zoho/with-zoho-credential';

export interface SyncReport {
  mode: 'delta' | 'full';
  pages: number;
  fetched: number;
  upserted: number;
  /** receiving_lines marked received because Zoho now reports their PO received/billed/closed. */
  reconciled: number;
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

async function upsertOne(po: ZohoPurchaseOrder, orgId: OrgId): Promise<boolean> {
  const id = asString(po.purchaseorder_id);
  const number = asString(po.purchaseorder_number);
  if (!id || !number) return false; // skip rows missing identity

  // organization_id stamped explicitly (data-correct regardless of GUC) and the
  // write runs under the tenant GUC via tenantQuery so it's FORCE-ready. ON
  // CONFLICT target stays the global zoho_purchaseorder_id (per-org Zoho ids
  // don't collide across tenants); per-org unique is a deploy-coupled follow-up.
  await tenantQuery(
    orgId,
    `INSERT INTO zoho_po_mirror
       (zoho_purchaseorder_id, zoho_purchaseorder_number, vendor_id, vendor_name,
        status, po_date, expected_delivery_date, reference_number, total, currency,
        raw, last_modified_zoho, organization_id, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW())
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
           organization_id           = COALESCE(zoho_po_mirror.organization_id, EXCLUDED.organization_id),
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
      orgId,
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
  orgId: OrgId,
): Promise<{ found: boolean; status: string | null }> {
  const id = (zohoPurchaseOrderId || '').trim();
  if (!id) return { found: false, status: null };
  const res = await withZohoCredential(orgId, 'purchaseorders.read', () => getPurchaseOrderById(id));
  const po = res?.purchaseorder;
  if (!po) return { found: false, status: null };
  const ok = await upsertOne(po, orgId);
  if (ok) {
    try {
      await reconcileZohoReceivedLines(orgId, { zohoPurchaseOrderId: id });
    } catch (err) {
      console.warn('syncOnePoMirror: received-reconcile failed (non-fatal)', err);
    }
  }
  return { found: ok, status: asString(po.status) };
}

export async function syncZohoPoMirror(opts: SyncOptions, orgId: OrgId): Promise<SyncReport> {
  const start = Date.now();
  const report: SyncReport = {
    mode: opts.mode,
    pages: 0,
    fetched: 0,
    upserted: 0,
    reconciled: 0,
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
    // Bind the whole paginated pull to this org's Zoho credential (allowlisted
    // + audited). Wrapping the entire for-await keeps the AsyncLocalStorage org
    // binding active across every page fetch (the generator resumes inside the
    // run scope); upsertOne stamps + GUC-scopes each write to the same org.
    await withZohoCredential(orgId, 'purchaseorders.read', async () => {
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
            if (await upsertOne(po, orgId)) report.upserted += 1;
          } catch (err) {
            const id = (po as { purchaseorder_id?: string }).purchaseorder_id ?? '(unknown)';
            report.errors.push(`po ${id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (report.fetched >= maxItems) break;
        if (report.pages >= maxPages) break;
      }
    });
  } catch (err) {
    report.errors.push(`fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Propagate fresh terminal statuses onto the local queue. Deliberately
  // unconditional (not gated on upserted > 0): a box door-scanned AFTER its PO
  // already went terminal in Zoho produces no new mirror upsert, yet its lines
  // still need clearing — and the operator Sync Zoho button must clear them
  // even on a no-change delta. With the partial indexes on zoho_po_mirror.status
  // and receiving(received_at/unboxed_at) the zero-candidate run is ~free.
  // Failure here must not fail the sync or stall the callers' cursor advance,
  // so it logs instead of pushing to errors.
  try {
    const { updated } = await reconcileZohoReceivedLines(orgId);
    report.reconciled = updated;
  } catch (err) {
    console.warn('syncZohoPoMirror: received-reconcile failed (non-fatal)', err);
  }

  report.elapsedMs = Date.now() - start;
  return report;
}
