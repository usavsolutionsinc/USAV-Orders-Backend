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

// A revoked/expired Google token or a never-connected mailbox isn't a server
// fault — it's an operator action ("reconnect"). Detect those so the button
// shows an actionable message instead of a generic 500.
function isReconnectNeeded(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('not connected') ||
    msg.includes('invalid_grant') ||
    msg.includes('expired or revoked') ||
    msg.includes('token refresh failed') ||
    msg.includes('needs_reconnect') ||
    msg.includes('po_gmail_client') // env not configured
  );
}

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
    if (isReconnectNeeded(error)) {
      return NextResponse.json(
        {
          success: false,
          needsReconnect: true,
          error:
            'PO mailbox needs reconnecting — its Google sign-in expired. ' +
            'An admin can reconnect it under Settings → Integrations → PO Mailbox.',
        },
        { status: 409 },
      );
    }
    return errorResponse(error, 'POST /api/receiving-lines/incoming/email-rescan');
  }
}, { permission: 'receiving.view' });
