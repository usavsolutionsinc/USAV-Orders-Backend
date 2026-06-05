/**
 * GET /api/admin/po-gmail/reconcile
 *
 * Fetches unread (or query-matched) Gmail messages from the PO mailbox,
 * extracts order-number candidates, diffs them against receiving_lines
 * (which is our Zoho mirror), and writes any *missing* matches into the
 * email_missing_purchase_orders worklist.
 *
 * Also auto-resolves any previously-missing rows whose PO has since
 * shown up in receiving_lines (covers the "vendor finally created the
 * Zoho PO an hour after emailing us" case).
 *
 * This is the read+reconcile pipeline. No Zoho API calls — webhooks +
 * the QStash safety-net cron keep receiving_lines populated.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { listMessageIds, fetchMessagesByIds } from '@/lib/po-gmail/messages';
import { extractOrderNumbers, extractTrackingNumbers, isOrderDeliveredSubject } from '@/lib/po-gmail/extract';
import {
  fetchMatchesByNormalizedPoNumbers,
  classifyMatches,
  normalizeOrderNumber,
  type MatchRow,
  type ReconciledStatus,
} from '@/lib/po-gmail/reconcile';
import { linkTrackingToPo } from '@/lib/po-gmail/link-tracking';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 25;
// Cap on the per-call scan window. Operators occasionally want to backfill
// (e.g. after fixing a parser bug), so 200 is the ceiling. Anything larger
// risks the function timing out — the cron is the right tool for ongoing
// sweeps, not a one-shot button.
const MAX_LIMIT = 200;
const BODY_PREVIEW_CHARS = 800;

interface ReconcileItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  internalDate: string;
  snippet: string;
  hasAttachments: boolean;
  bodyPreview: string;
  bodyTruncated: boolean;
  bodyLength: number;
  extracted: { all: string[]; labeled: string[]; unlabeled: string[] };
  /** Carrier tracking#s pulled from the body (closes the AWAITING_TRACKING gap). */
  trackingCandidates: string[];
  matches: MatchRow[];
  matchedPoNumbers: string[];
  status: ReconciledStatus;
  /** Subject signals delivery ("ORDER DELIVERED") — logs an email_delivery_signal. */
  delivered: boolean;
}

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const query = url.searchParams.get('q') ?? 'is:unread';
    const persist = url.searchParams.get('persist') !== 'false'; // default true

    const startedAt = Date.now();
    const { ids } = await listMessageIds(query, limit);
    const messages = await fetchMessagesByIds(ids);

    // Build the union of normalized candidates across all messages, so we
    // can do one ANY($1) query against receiving_lines regardless of N.
    // Tracking# extraction runs alongside PO extraction so the same email
    // body is parsed once. Tracking-link writes only happen below for emails
    // whose POs actually match (status='in_zoho' / 'received').
    const perMessageExtracted = messages.map((m) => {
      const body = `${m.subject}\n${m.bodyText}`;
      const e = extractOrderNumbers(body);
      const t = extractTrackingNumbers(body);
      const norm = Array.from(new Set(e.all.map(normalizeOrderNumber).filter(Boolean)));
      return { message: m, extracted: e, tracking: t, norm };
    });
    const allNorm = Array.from(
      new Set(perMessageExtracted.flatMap((r) => r.norm)),
    );

    const matchMap = await fetchMatchesByNormalizedPoNumbers(allNorm);

    // Counts for UI summary
    const counts = { missing: 0, in_zoho: 0, received: 0, no_match: 0 };
    const items: ReconcileItem[] = perMessageExtracted.map(({ message: m, extracted, tracking, norm }) => {
      const matches: MatchRow[] = [];
      const matchedPoNumbers = new Set<string>();
      for (const n of norm) {
        const hit = matchMap.get(n);
        if (!hit) continue;
        matches.push(hit);
        if (hit.zoho_purchaseorder_number) matchedPoNumbers.add(hit.zoho_purchaseorder_number);
      }

      let status: ReconciledStatus;
      if (norm.length === 0) status = 'no_match';
      else status = classifyMatches(matches);

      counts[status]++;
      return {
        id: m.id,
        threadId: m.threadId,
        subject: m.subject,
        from: m.from,
        date: m.date,
        internalDate: m.internalDate,
        snippet: m.snippet,
        hasAttachments: m.hasAttachments,
        bodyPreview: m.bodyText.slice(0, BODY_PREVIEW_CHARS),
        bodyTruncated: m.bodyText.length > BODY_PREVIEW_CHARS,
        bodyLength: m.bodyText.length,
        extracted: { all: extracted.all, labeled: extracted.labeled, unlabeled: extracted.unlabeled },
        trackingCandidates: tracking,
        matches,
        matchedPoNumbers: Array.from(matchedPoNumbers),
        status,
        delivered: isOrderDeliveredSubject(m.subject),
      };
    });

    // Persist results: missing → upsert worklist; in_zoho/received → flip
    // any existing pending row for the same gmail_msg_id to resolved.
    let upserted = 0;
    let resolved = 0;
    // "ORDER DELIVERED" emails → email_delivery_signals (drives the Incoming
    // "Delivered · not scanned" email path). Counted across the run.
    let deliverySignals = 0;
    // Aggregate Gmail-leg tracking-link counts so the response surfaces
    // exactly how many shipment_id stamps this run produced.
    let trackingLinked = 0;
    let trackingAlreadyLinked = 0;
    let trackingRejected = 0;
    if (persist && items.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const item of items) {
          // Delivery signal is independent of match status: a delivered eBay
          // order is usually already in receiving (matched), just not scanned
          // at the dock — so we log it whether or not it's in the worklist.
          if (item.delivered) {
            const deliveredAt = item.internalDate ? new Date(Number(item.internalDate)) : null;
            for (const ord of item.extracted.all) {
              const ordNorm = normalizeOrderNumber(ord);
              if (!ordNorm) continue;
              const { rowCount } = await client.query(
                `INSERT INTO email_delivery_signals
                   (gmail_msg_id, gmail_thread_id, order_number, order_number_norm,
                    email_subject, email_from, snippet, delivered_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()))
                 ON CONFLICT (organization_id, gmail_msg_id, order_number_norm) DO UPDATE
                   SET email_subject = EXCLUDED.email_subject,
                       email_from    = EXCLUDED.email_from,
                       snippet       = EXCLUDED.snippet,
                       delivered_at  = EXCLUDED.delivered_at`,
                [
                  item.id,
                  item.threadId,
                  ord,
                  ordNorm,
                  item.subject || null,
                  item.from || null,
                  item.snippet || null,
                  deliveredAt,
                ],
              );
              deliverySignals += rowCount ?? 0;
            }
          }

          if (item.status === 'missing') {
            const { rowCount } = await client.query(
              `INSERT INTO email_missing_purchase_orders
                 (gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
                  email_subject, email_from, email_received, scanned_at, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'pending')
               ON CONFLICT (organization_id, gmail_msg_id) DO UPDATE
                 SET po_numbers      = EXCLUDED.po_numbers,
                     po_numbers_norm = EXCLUDED.po_numbers_norm,
                     email_subject   = EXCLUDED.email_subject,
                     email_from      = EXCLUDED.email_from,
                     email_received  = EXCLUDED.email_received,
                     scanned_at      = NOW(),
                     status          = CASE
                                         WHEN email_missing_purchase_orders.status = 'ignored' THEN 'ignored'
                                         ELSE 'pending'
                                       END,
                     resolved_at     = NULL`,
              [
                item.id,
                item.threadId,
                item.extracted.all,
                item.extracted.all.map(normalizeOrderNumber).filter(Boolean),
                item.subject || null,
                item.from || null,
                item.internalDate ? new Date(Number(item.internalDate)) : null,
              ],
            );
            upserted += rowCount ?? 0;
          } else if (item.status === 'in_zoho' || item.status === 'received') {
            // If this gmail_msg_id was previously logged as missing, mark
            // it resolved (the PO has since appeared in receiving_lines).
            const { rowCount } = await client.query(
              `UPDATE email_missing_purchase_orders
                  SET status      = 'resolved',
                      resolved_at = NOW()
                WHERE gmail_msg_id = $1
                  AND status       = 'pending'`,
              [item.id],
            );
            resolved += rowCount ?? 0;

            // Gmail leg: when the email body carries a carrier tracking#
            // AND the matched Zoho PO's receiving row has no shipment_id
            // yet, stamp it. Drains the AWAITING_TRACKING bucket on the
            // Incoming pill for POs purchasing never put a `reference_number`
            // on. linkTrackingToPo runs outside the transaction so a slow
            // upsertShipment call doesn't keep the worklist lock open.
            if (item.trackingCandidates.length > 0) {
              for (const match of item.matches) {
                if (!match.zoho_purchaseorder_id) continue;
                try {
                  const r = await linkTrackingToPo({
                    zoho_purchaseorder_id: match.zoho_purchaseorder_id,
                    trackingCandidates: item.trackingCandidates,
                    sourceSystem: 'po-gmail.reconcile',
                  });
                  trackingLinked += r.linked;
                  trackingAlreadyLinked += r.alreadyLinked;
                  trackingRejected += r.rejectedCandidates;
                } catch (err) {
                  console.warn(
                    'po-gmail.reconcile: linkTrackingToPo failed (non-fatal)',
                    { po_id: match.zoho_purchaseorder_id, err: err instanceof Error ? err.message : err },
                  );
                }
              }
            }
          }
        }

        // Belt-and-suspenders auto-resolve: any pending rows in the
        // worklist whose POs now exist in receiving_lines (regardless of
        // whether we scanned them again) should clear.
        const ar = await client.query(
          `UPDATE email_missing_purchase_orders e
              SET status = 'resolved', resolved_at = NOW()
            WHERE e.status = 'pending'
              AND EXISTS (
                SELECT 1
                FROM receiving_lines rl
                WHERE rl.zoho_purchaseorder_number_norm = ANY(e.po_numbers_norm)
              )`,
        );
        resolved += ar.rowCount ?? 0;

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({
      query,
      limit,
      counts,
      persisted: persist
        ? {
            upserted,
            resolved,
            delivery_signals: deliverySignals,
            tracking_linked: trackingLinked,
            tracking_already_linked: trackingAlreadyLinked,
            tracking_rejected: trackingRejected,
          }
        : null,
      elapsedMs: Date.now() - startedAt,
      items,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/reconcile');
  }
}, { permission: 'admin.view' });
