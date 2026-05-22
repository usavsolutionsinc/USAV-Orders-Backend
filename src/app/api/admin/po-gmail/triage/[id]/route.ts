/**
 * PATCH /api/admin/po-gmail/triage/[id]
 *
 * Move a scanned email between piles (inbox / upload / ignore / done)
 * and/or update its per-field triage state (extraction confirmations,
 * notes, Zoho PO# the human typed in).
 *
 * Body (all fields optional, but at least one must be present):
 *   {
 *     pile?:                    'inbox' | 'upload' | 'ignore' | 'done',
 *     triage_state?:            object,    // deep-merged into existing JSONB
 *     notes?:                   string,
 *     assigned_to?:             uuid | null,
 *     zoho_uploaded_po_number?: string | null
 *   }
 *
 * Setting `pile = 'done'` (or `zoho_uploaded_po_number`) timestamps
 * `zoho_uploaded_at` if it isn't already set, so the auto-resolve loop
 * (po-sync cron) has a record of the human's action even if the mirror
 * hasn't caught up yet.
 *
 * `status` and `resolved_at` are kept in lockstep with `pile` by the
 * email_missing_purchase_orders_sync_status trigger — callers don't need
 * to touch them directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { ApiError, errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

const VALID_PILES = new Set(['inbox', 'upload', 'ignore', 'done']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(req, 'admin.view');
  if (gate.denied) return gate.denied;

  try {
    const { id } = await params;
    if (!id) throw ApiError.badRequest('id is required');

    const body = await req.json().catch(() => ({}));
    const pile = typeof body.pile === 'string' ? body.pile : undefined;
    const triageState =
      body.triage_state && typeof body.triage_state === 'object' && !Array.isArray(body.triage_state)
        ? (body.triage_state as Record<string, unknown>)
        : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    const assignedTo =
      body.assigned_to === null
        ? null
        : typeof body.assigned_to === 'string'
          ? body.assigned_to
          : undefined;
    const zohoUploadedPoNumber =
      body.zoho_uploaded_po_number === null
        ? null
        : typeof body.zoho_uploaded_po_number === 'string'
          ? body.zoho_uploaded_po_number.trim() || null
          : undefined;

    if (
      pile === undefined &&
      triageState === undefined &&
      notes === undefined &&
      assignedTo === undefined &&
      zohoUploadedPoNumber === undefined
    ) {
      throw ApiError.badRequest(
        'at least one of pile, triage_state, notes, assigned_to, zoho_uploaded_po_number is required',
      );
    }

    if (pile !== undefined && !VALID_PILES.has(pile)) {
      throw ApiError.badRequest(`pile must be one of: ${[...VALID_PILES].join(', ')}`);
    }

    // Build the SET clause dynamically so we only touch the columns the
    // caller asked about. JSONB triage_state is merged (||) so partial
    // confirmations don't clobber prior state.
    const sets: string[] = [];
    const sqlParams: unknown[] = [id];
    const next = (v: unknown) => {
      sqlParams.push(v);
      return `$${sqlParams.length}`;
    };

    if (pile !== undefined) sets.push(`pile = ${next(pile)}`);
    if (triageState !== undefined) {
      sets.push(`triage_state = triage_state || ${next(JSON.stringify(triageState))}::jsonb`);
    }
    if (notes !== undefined) sets.push(`notes = ${next(notes)}`);
    if (assignedTo !== undefined) sets.push(`assigned_to = ${next(assignedTo)}`);
    if (zohoUploadedPoNumber !== undefined) {
      sets.push(`zoho_uploaded_po_number = ${next(zohoUploadedPoNumber)}`);
      if (zohoUploadedPoNumber === null) {
        sets.push(`zoho_uploaded_at = NULL`);
      } else {
        sets.push(`zoho_uploaded_at = COALESCE(zoho_uploaded_at, NOW())`);
      }
    } else if (pile === 'done') {
      sets.push(`zoho_uploaded_at = COALESCE(zoho_uploaded_at, NOW())`);
    }

    const { rowCount, rows } = await pool.query(
      `UPDATE email_missing_purchase_orders
          SET ${sets.join(', ')}
        WHERE id = $1
        RETURNING id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
                  email_subject, email_from, email_received, scanned_at,
                  pile, status, notes, assigned_to,
                  zoho_uploaded_po_number, zoho_uploaded_at,
                  triage_state, resolved_at`,
      sqlParams,
    );

    if (!rowCount) throw ApiError.notFound('email_missing_purchase_orders', id);
    return NextResponse.json({ ok: true, row: rows[0] });
  } catch (error) {
    return errorResponse(error, 'PATCH /api/admin/po-gmail/triage/[id]');
  }
}
