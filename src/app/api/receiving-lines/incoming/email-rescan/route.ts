/**
 * POST /api/receiving-lines/incoming/email-rescan
 *
 * Receiving-floor counterpart to /api/admin/po-gmail/reconcile. Drives the
 * Incoming toolbar's "Email" button: rescans the PO mailbox for "ORDER
 * DELIVERED" emails (feeding the Delivered · not scanned surface), upserts
 * missing POs, resolves now-present ones, and links any carrier tracking#.
 *
 * Gated on `receiving.view` to match its toolbar siblings (Zoho / Tracking)
 * — the admin reconcile route stays `admin.view` because it returns raw
 * email bodies for the triage UI. This route returns COUNTS ONLY (no email
 * subjects, senders, or bodies), so receiving staff get the sync summary
 * without the PII surface.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { runPoMailboxReconcile } from '@/lib/po-gmail/reconcile-run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_LIMIT = 50;

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);

    const result = await runPoMailboxReconcile({
      limit: Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT,
      query: 'is:unread',
      persist: true,
    });

    // Counts only — deliberately omit `items` (email bodies/PII).
    return NextResponse.json({
      success: true,
      counts: result.counts,
      persisted: result.persisted,
      scanned: result.items.length,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-lines/incoming/email-rescan');
  }
}, { permission: 'receiving.view' });
