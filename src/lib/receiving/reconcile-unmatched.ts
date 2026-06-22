/**
 * Unmatched-receiving reconciliation.
 *
 * Background: when a tracking number scans into receiving with no Zoho PO
 * match, /api/receiving/lookup-po creates a `receiving` row with
 * source='unmatched' and a `tracking_exceptions` row. Later — sometimes
 * minutes, sometimes days — the matching Zoho PO arrives (via cron sync or
 * a vendor uploading the PO). At that point the unmatched receiving COULD
 * be promoted to a Zoho-linked one, but nothing was wired to do that.
 *
 * This helper re-runs the same Zoho tracking search that lookup-po does,
 * and if it now finds a PO, promotes the receiving in place:
 *   • receiving.source           → 'zoho_po'
 *   • receiving.zoho_purchaseorder_id → matched PO id
 *   • receiving_lines             → imported from the Zoho PO
 *   • tracking_exceptions        → resolved
 *   • unfound_overlay            → checked (operator can ignore the row)
 *
 * Trigger points:
 *   • Hourly cron sweep (src/app/api/cron/reconcile-unmatched/route.ts)
 *   • Manually from the unfound queue UI ("Retry Zoho lookup" — Phase 4)
 *   • After mailbox triage marks a PO uploaded (Phase 4)
 *
 * Failures are non-fatal — anything that goes wrong leaves the receiving
 * as 'unmatched' and the helper returns { promoted: false, reason }. The
 * caller decides whether to retry.
 */

import pool from '@/lib/db';
import {
  searchPurchaseReceivesByTracking,
  searchPurchaseOrdersByTracking,
} from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { resolveReceivingExceptionsByReceivingId } from '@/lib/tracking-exceptions';

export interface ReconcileResult {
  receivingId: number;
  promoted: boolean;
  /** Set when promoted; the Zoho PO id that won the match. */
  zohoPurchaseorderId?: string;
  /** Number of receiving_lines created by the Zoho import. */
  linesImported?: number;
  /** Number of tracking_exceptions rows closed. */
  exceptionsResolved?: number;
  /** Short reason explaining why promotion was skipped or failed. */
  reason?: string;
}

interface ReceivingSnapshot {
  id: number;
  source: string | null;
  receiving_tracking_number: string | null;
  organization_id: string | null;
}

function last8Digits(tracking: string | null | undefined): string | null {
  const digits = String(tracking || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-8);
}

export async function reconcileUnmatchedReceiving(
  receivingId: number,
): Promise<ReconcileResult> {
  // ─── Load the receiving row ─────────────────────────────────────────────
  const recRes = await pool.query<ReceivingSnapshot>(
    `SELECT id, source, receiving_tracking_number, organization_id
       FROM receiving
      WHERE id = $1
      LIMIT 1`,
    [receivingId],
  );
  const rec = recRes.rows[0];
  if (!rec) {
    return { receivingId, promoted: false, reason: 'receiving not found' };
  }
  if (rec.source !== 'unmatched') {
    return {
      receivingId,
      promoted: false,
      reason: `already ${rec.source}`,
    };
  }

  const last8 = last8Digits(rec.receiving_tracking_number);
  if (!last8) {
    return {
      receivingId,
      promoted: false,
      reason: 'tracking number has fewer than 8 digits',
    };
  }

  // ─── Re-query Zoho ──────────────────────────────────────────────────────
  // Same fallback chain as lookup-po: purchase_receives first (closer to
  // operator's mental model), then purchase_orders. Both throws are
  // swallowed — "no match" and "outage" both leave the receiving unmatched
  // (the caller can retry on the next cron tick).
  const zohoPoIds = new Set<string>();
  try {
    const receives = await searchPurchaseReceivesByTracking(last8).catch(() => []);
    for (const r of receives) {
      const poId = String(r.purchaseorder_id || '');
      if (poId) zohoPoIds.add(poId);
    }
    if (zohoPoIds.size === 0) {
      const pos = await searchPurchaseOrdersByTracking(last8).catch(() => []);
      for (const po of pos) {
        if (po.purchaseorder_id) zohoPoIds.add(po.purchaseorder_id);
      }
    }
  } catch (err) {
    return {
      receivingId,
      promoted: false,
      reason: `zoho lookup threw: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  if (zohoPoIds.size === 0) {
    return { receivingId, promoted: false, reason: 'no zoho match yet' };
  }

  const poIds = Array.from(zohoPoIds);
  const primaryPoId = poIds[0]!;

  // ─── Promote in place ───────────────────────────────────────────────────
  // Same UPDATE pattern lookup-po uses on its preassigned-receiving branch
  // (route.ts:410-420). The WHERE clause guards against a race where the
  // row got promoted between our SELECT and UPDATE — if it did, we just
  // skip the promotion and treat the existing zoho_purchaseorder_id as
  // authoritative.
  let promoted = false;
  try {
    const promoteRes = await pool.query<{ id: number }>(
      `UPDATE receiving
          SET source = 'zoho_po',
              zoho_purchaseorder_id = $1,
              updated_at = NOW()
        WHERE id = $2
          AND (source = 'unmatched' OR zoho_purchaseorder_id IS NULL)
        RETURNING id`,
      [primaryPoId, receivingId],
    );
    promoted = promoteRes.rowCount! > 0;
  } catch (err) {
    // A unique-index conflict on (zoho_purchaseorder_id) WHERE source='zoho_po'
    // means another `receiving` row already owns this PO. Leaving the
    // unmatched row as-is is safer than merging — the operator can decide.
    return {
      receivingId,
      promoted: false,
      reason: `promote update failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  if (!promoted) {
    return {
      receivingId,
      promoted: false,
      reason: 'row no longer unmatched (race)',
    };
  }

  // ─── Import Zoho lines ──────────────────────────────────────────────────
  // The Zoho import is tenant-scoped (opens a withTenantTransaction under the
  // receiving's org), so it needs the receiving row's organization_id. Legacy
  // rows without one are skipped non-fatally — promotion already succeeded and
  // a later reconcile tick can import lines once the org is backfilled.
  let linesImported = 0;
  if (!rec.organization_id) {
    console.warn(
      `[reconcile-unmatched] receiving=${receivingId} has no organization_id; skipping Zoho line import`,
    );
  } else {
    try {
      const importResult = await importZohoPurchaseOrderToReceiving(
        rec.organization_id,
        primaryPoId,
      );
      // importZohoPurchaseOrderToReceiving's return shape varies; count rows
      // defensively. We only care about a rough number for telemetry.
      if (importResult && typeof importResult === 'object') {
        const maybeLines = (importResult as { linesImported?: number; lines?: unknown[] })
          .linesImported;
        const maybeArr = (importResult as { lines?: unknown[] }).lines;
        linesImported = typeof maybeLines === 'number'
          ? maybeLines
          : Array.isArray(maybeArr)
            ? maybeArr.length
            : 0;
      }
    } catch (err) {
      // Promotion succeeded but line import failed. The receiving row now has
      // source='zoho_po' and the right PO id; the next mark-received-po call
      // (or another reconcile tick) will sync the lines. Log + continue.
      console.warn(
        `[reconcile-unmatched] line import failed for receiving=${receivingId} po=${primaryPoId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ─── Close open tracking exceptions for this receiving ──────────────────
  const exceptionsResolved = await resolveReceivingExceptionsByReceivingId(
    receivingId,
  ).catch(() => 0);

  // ─── Mark the overlay row checked so it falls out of the unfound queue ──
  // Best-effort — if the overlay row doesn't exist yet, INSERT it as checked.
  try {
    await pool.query(
      `INSERT INTO unfound_overlay
         (organization_id, source_kind, source_id, checked, checked_at)
       VALUES ($1, 'unmatched_receiving', $2, TRUE, NOW())
       ON CONFLICT (organization_id, source_kind, source_id) DO UPDATE
         SET checked = TRUE,
             checked_at = COALESCE(unfound_overlay.checked_at, NOW())`,
      [rec.organization_id, String(receivingId)],
    );
  } catch (err) {
    console.warn(
      `[reconcile-unmatched] overlay check failed for receiving=${receivingId}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return {
    receivingId,
    promoted: true,
    zohoPurchaseorderId: primaryPoId,
    linesImported,
    exceptionsResolved,
  };
}

/**
 * Sweep recent unmatched receivings, retrying Zoho lookup for each.
 *
 * Returns per-row results so the cron caller can log the summary. Caps the
 * batch at `limit` (default 50) per invocation so a 7-day backlog never
 * blocks the cron window.
 */
export async function sweepUnmatchedReceivings(
  options: {
    /** Cutoff age in days; rows older than this are skipped. Default 7. */
    maxAgeDays?: number;
    /** Max rows to process per call. Default 50. */
    limit?: number;
  } = {},
): Promise<{
  scanned: number;
  promoted: number;
  results: ReconcileResult[];
}> {
  const maxAgeDays = Math.max(1, Math.min(30, options.maxAgeDays ?? 7));
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));

  const candidates = await pool.query<{ id: number }>(
    `SELECT id
       FROM receiving
      WHERE source = 'unmatched'
        AND receiving_tracking_number IS NOT NULL
        AND receiving_date_time > NOW() - ($1 || ' days')::interval
      ORDER BY receiving_date_time DESC
      LIMIT $2`,
    [String(maxAgeDays), limit],
  );

  const results: ReconcileResult[] = [];
  let promoted = 0;
  for (const row of candidates.rows) {
    const r = await reconcileUnmatchedReceiving(Number(row.id));
    results.push(r);
    if (r.promoted) promoted++;
  }

  return { scanned: candidates.rows.length, promoted, results };
}
