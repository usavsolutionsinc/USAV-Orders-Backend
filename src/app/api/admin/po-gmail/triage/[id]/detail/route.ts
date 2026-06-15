/**
 * GET /api/admin/po-gmail/triage/[id]/detail
 *
 * One-shot fetch for the checklist pane: the worklist row, the live
 * Gmail body, and a small "Zoho compare" payload (POs already in the
 * mirror that match this email + the vendor + open-PO count for that
 * vendor). Used to populate the right-pane checklist on /inventory/po-mailbox.
 *
 * The body is fetched live from Gmail (not stored on the row) so a
 * vendor who edits or forwards the thread is reflected immediately.
 * Live fetch keeps the worklist row small and avoids stale body text
 * surviving in our DB after the user purges Gmail.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { ApiError, errorResponse } from '@/lib/api';
import { fetchMessage } from '@/lib/po-gmail/messages';

export const dynamic = 'force-dynamic';

interface TriageRowRecord {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  po_numbers: string[];
  po_numbers_norm: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  pile: 'inbox' | 'upload' | 'ignore' | 'done';
  status: string;
  notes: string | null;
  assigned_to: string | null;
  zoho_uploaded_po_number: string | null;
  zoho_uploaded_at: string | null;
  triage_state: Record<string, unknown>;
  resolved_at: string | null;
}

interface ZohoMatchRow {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string;
  zoho_purchaseorder_number_norm: string;
  vendor_id: string | null;
  vendor_name: string | null;
  status: string | null;
  po_date: string | null;
  total: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'admin.view');
  if (gate.denied) return gate.denied;
  const { organizationId } = gate.ctx;

  try {
    const { id } = await params;
    if (!id) throw ApiError.badRequest('id is required');

    const { rows } = await pool.query<TriageRowRecord>(
      `SELECT id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
              email_subject, email_from, email_received, scanned_at,
              pile, status, notes, assigned_to,
              zoho_uploaded_po_number, zoho_uploaded_at,
              triage_state, resolved_at
         FROM email_missing_purchase_orders
        WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      throw ApiError.notFound('email_missing_purchase_orders', id);
    }
    const row = rows[0];

    // Run the Gmail fetch and Zoho compare query in parallel — they're
    // independent and the Gmail call dominates wall time.
    const [bodyResult, existingPosResult] = await Promise.allSettled([
      row.gmail_msg_id ? fetchMessage(row.gmail_msg_id, organizationId) : Promise.resolve(null),
      row.po_numbers_norm.length > 0
        ? pool.query<ZohoMatchRow>(
            `SELECT zoho_purchaseorder_id, zoho_purchaseorder_number,
                    zoho_purchaseorder_number_norm, vendor_id, vendor_name,
                    status, po_date, total::text
               FROM zoho_po_mirror
              WHERE zoho_purchaseorder_number_norm = ANY($1::text[])`,
            [row.po_numbers_norm],
          )
        : Promise.resolve({ rows: [] as ZohoMatchRow[] }),
    ]);

    const body =
      bodyResult.status === 'fulfilled' && bodyResult.value
        ? {
            text: bodyResult.value.bodyText,
            html: bodyResult.value.bodyHtml,
            length: bodyResult.value.bodyText.length,
            subject: bodyResult.value.subject,
            from: bodyResult.value.from,
            to: bodyResult.value.to,
            date: bodyResult.value.date,
            hasAttachments: bodyResult.value.hasAttachments,
            error: null as string | null,
          }
        : {
            text: '',
            html: null as string | null,
            length: 0,
            subject: row.email_subject ?? '',
            from: row.email_from ?? '',
            to: '',
            date: row.email_received ?? '',
            hasAttachments: false,
            error:
              bodyResult.status === 'rejected'
                ? bodyResult.reason instanceof Error
                  ? bodyResult.reason.message
                  : 'Gmail fetch failed'
                : 'No Gmail message id on this row',
          };

    const existingPos =
      existingPosResult.status === 'fulfilled' ? existingPosResult.value.rows : [];

    // Pick a vendor from any matched PO. If multiple matches name different
    // vendors, we'll prefer the most recent po_date — but in practice the
    // PO# is the identity, so collisions across vendors should be rare.
    const matchedVendor = (() => {
      const named = existingPos.filter((p) => p.vendor_id && p.vendor_name);
      if (named.length === 0) return null;
      const sorted = [...named].sort((a, b) => (b.po_date ?? '').localeCompare(a.po_date ?? ''));
      return { vendor_id: sorted[0].vendor_id, vendor_name: sorted[0].vendor_name };
    })();

    // Count open POs for the matched vendor (lightweight context for the
    // human deciding whether this is a duplicate of an existing PO).
    let openPoCountForVendor: number | null = null;
    if (matchedVendor?.vendor_id) {
      const { rows: countRows } = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM zoho_po_mirror
          WHERE vendor_id = $1
            AND status IN ('draft', 'open', 'pending_approval', 'approved')`,
        [matchedVendor.vendor_id],
      );
      openPoCountForVendor = Number(countRows[0]?.n ?? 0);
    }

    return NextResponse.json({
      row,
      body,
      zohoCompare: {
        existingPos,
        matchedVendor,
        openPoCountForVendor,
      },
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/triage/[id]/detail');
  }
}
