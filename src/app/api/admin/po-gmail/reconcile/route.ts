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
 *
 * The core pipeline lives in `@/lib/po-gmail/reconcile-run`; this admin
 * route returns the FULL payload (incl. per-message email bodies) for the
 * triage UI. The Incoming toolbar's Email button uses a separate
 * receiving-scoped route that returns counts only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { runPoMailboxReconcile, DEFAULT_LIMIT } from '@/lib/po-gmail/reconcile-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
    const query = url.searchParams.get('q') ?? 'is:unread';
    const persist = url.searchParams.get('persist') !== 'false'; // default true

    const result = await runPoMailboxReconcile({ limit: limitRaw, query, persist });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/reconcile');
  }
}, { permission: 'admin.view' });
