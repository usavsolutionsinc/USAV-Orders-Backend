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
import { extractOrderNumbers } from '@/lib/po-gmail/extract';
import {
  fetchMatchesByNormalizedPoNumbers,
  classifyMatches,
  normalizeOrderNumber,
  type MatchRow,
  type ReconciledStatus,
} from '@/lib/po-gmail/reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
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
  matches: MatchRow[];
  matchedPoNumbers: string[];
  status: ReconciledStatus;
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
    const perMessageExtracted = messages.map((m) => {
      const e = extractOrderNumbers(`${m.subject}\n${m.bodyText}`);
      const norm = Array.from(new Set(e.all.map(normalizeOrderNumber).filter(Boolean)));
      return { message: m, extracted: e, norm };
    });
    const allNorm = Array.from(
      new Set(perMessageExtracted.flatMap((r) => r.norm)),
    );

    const matchMap = await fetchMatchesByNormalizedPoNumbers(allNorm);

    // Counts for UI summary
    const counts = { missing: 0, in_zoho: 0, received: 0, no_match: 0 };
    const items: ReconcileItem[] = perMessageExtracted.map(({ message: m, extracted, norm }) => {
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
        matches,
        matchedPoNumbers: Array.from(matchedPoNumbers),
        status,
      };
    });

    // Persist results: missing → upsert worklist; in_zoho/received → flip
    // any existing pending row for the same gmail_msg_id to resolved.
    let upserted = 0;
    let resolved = 0;
    if (persist && items.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const item of items) {
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
      persisted: persist ? { upserted, resolved } : null,
      elapsedMs: Date.now() - startedAt,
      items,
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/reconcile');
  }
}, { permission: 'admin.view' });
