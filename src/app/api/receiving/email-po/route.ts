/**
 * /api/receiving/email-po
 *
 * Operator-facing search over the PO-Gmail worklist (`email_missing_purchase_orders`)
 * — the purchase-order confirmation emails that were ingested from Gmail but had
 * no Zoho match. This is how a carton whose tracking arrived (but whose PO was
 * never imported, because the seller never gave the buyer tracking) gets paired
 * to its order: the operator finds the matching PO email here and links it.
 *
 * GET  ?q=…  → search pending email POs by PO number / subject / sender.
 * PATCH { id } → mark an email PO row 'resolved' (after the carton is linked).
 *
 * The carton↔PO# write itself reuses the existing PATCH /api/receiving/:id
 * ({ zoho_purchaseorder_number }) which flips the carton off the Unfound queue.
 * Org-scoped throughout (the worklist carries organization_id). The admin
 * console has its own admin-gated view of the same table; this is the
 * receiving-permissioned slice for the bench.
 */

import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

interface EmailPoRow {
  id: string;
  gmail_msg_id: string;
  po_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
}

export const GET = withAuth(
  async (request: NextRequest, ctx) => {
    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    // Empty/short query → return the most recent pending PO emails (the locally
    // stored worklist) so the tab lists them by default; ≥2 chars filters.
    const hasQuery = q.length >= 2;
    const norm = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const like = `%${q}%`;

    const { rows } = await tenantQuery<EmailPoRow>(
      ctx.organizationId,
      `SELECT id,
              gmail_msg_id,
              po_numbers,
              email_subject,
              email_from,
              to_char(email_received, 'YYYY-MM-DD"T"HH24:MI:SS') AS email_received
         FROM email_missing_purchase_orders
        WHERE organization_id = $1
          AND status = 'pending'
          AND ($4 = false OR (
            ($2 <> '' AND EXISTS (
              SELECT 1 FROM unnest(po_numbers_norm) pn WHERE pn LIKE '%' || $2 || '%'
            ))
            OR email_subject ILIKE $3
            OR email_from ILIKE $3
            OR array_to_string(po_numbers, ' ') ILIKE $3
          ))
        ORDER BY email_received DESC NULLS LAST, scanned_at DESC
        LIMIT 20`,
      [ctx.organizationId, norm, like, hasQuery],
    );

    return NextResponse.json({
      success: true,
      candidates: rows.map((r) => ({
        id: String(r.id),
        gmail_msg_id: r.gmail_msg_id,
        po_numbers: Array.isArray(r.po_numbers) ? r.po_numbers : [],
        email_subject: r.email_subject,
        email_from: r.email_from,
        email_received: r.email_received,
      })),
    });
  },
  { permission: 'receiving.scan_po' },
);

export const PATCH = withAuth(
  async (request: NextRequest, ctx) => {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    // Org-ownership gate via the WHERE clause: a row owned by another org
    // matches nothing → rowCount 0 → 404 (never 403). Marking it resolved is
    // the self-heal once the operator has linked the PO# onto the carton.
    const { rowCount } = await withTenantTransaction(ctx.organizationId, (client) =>
      client.query(
        `UPDATE email_missing_purchase_orders
            SET status = 'resolved', resolved_at = NOW()
          WHERE id = $1 AND organization_id = $2`,
        [id, ctx.organizationId],
      ),
    );
    if (!rowCount) {
      return NextResponse.json({ success: false, error: 'email PO not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  },
  { permission: 'receiving.mark_received' },
);
