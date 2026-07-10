/**
 * Receiving-scoped to-do list seeded from incoming email order numbers.
 *
 * GET  /api/receiving-lines/incoming/todo
 *   Returns the open (`inbox` / `upload`) and recently-checked (`done`) email
 *   worklist rows — the unmatched-shipping-email pile from
 *   `email_missing_purchase_orders`. Each open email references an order# but
 *   has no PO in the system yet, so it's the first actionable step in the
 *   inbound funnel (see docs/incoming-tracking-todo-plan.md, Tier 0).
 *
 *   Optional `?q=` filters server-side across order numbers / subject / sender
 *   so the sidebar search narrows the list without re-fetching a wider set.
 *
 * PATCH /api/receiving-lines/incoming/todo
 *   Body: { id: string, done: boolean }
 *   Check a to-do off (`done: true` → pile='done') or restore it
 *   (`done: false` → pile='inbox'). Fully reversible — this is a pile move on
 *   an existing row, never a delete. The
 *   `email_missing_purchase_orders_sync_status` trigger keeps `status` /
 *   `resolved_at` in lockstep with `pile`.
 *
 * Both verbs are gated on `receiving.view` (matching the Incoming toolbar
 * siblings — Zoho / Tracking / Email rescan) rather than the `admin.view`
 * triage routes, so floor staff can work the list. The GET returns only the
 * fields the sidebar shows; the admin triage UI keeps its richer surface.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction, tenantQuery } from '@/lib/tenancy/db';
import { ApiError, errorResponse } from '@/lib/api';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

export const dynamic = 'force-dynamic';

/** Open piles surfaced as actionable to-dos (FIFO, oldest first). */
const OPEN_PILES = ['inbox', 'upload'] as const;
/** Hard cap per group — keeps payload + render bounded; UI shows "+N more". */
const MAX_OPEN = 50;
const MAX_DONE = 25;

interface TodoRow {
  id: string;
  order_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  pile: string;
  resolved_at: string | null;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();

    // Free-text filter: match the typed order#, subject, or sender. `po_numbers`
    // is text[] so we unnest+ILIKE via a correlated EXISTS to avoid array-cast
    // surprises. Parameterised — no string interpolation of user input.
    const filterSql = q
      ? `AND (
            EXISTS (
              SELECT 1 FROM unnest(po_numbers) pn
               WHERE pn ILIKE $2
            )
            OR email_subject ILIKE $2
            OR email_from ILIKE $2
         )`
      : '';
    const params: unknown[] = [orgId];
    if (q) params.push(`%${q}%`);

    const openRes = await tenantQuery<TodoRow>(
      orgId,
      `SELECT id, po_numbers AS order_numbers,
              email_subject, email_from, email_received, scanned_at,
              pile, resolved_at
         FROM email_missing_purchase_orders
        WHERE organization_id = $1
          AND pile IN ('inbox','upload')
          ${filterSql}
        ORDER BY scanned_at ASC
        LIMIT ${MAX_OPEN + 1}`,
      params,
    );

    const doneRes = await tenantQuery<TodoRow>(
      orgId,
      `SELECT id, po_numbers AS order_numbers,
              email_subject, email_from, email_received, scanned_at,
              pile, resolved_at
         FROM email_missing_purchase_orders
        WHERE organization_id = $1
          AND pile = 'done'
          ${filterSql}
        ORDER BY COALESCE(resolved_at, scanned_at) DESC
        LIMIT ${MAX_DONE + 1}`,
      params,
    );

    // Total open count is independent of the display cap so the header shows the
    // true backlog even when the list is truncated.
    const countRes = await tenantQuery<{ open: string }>(
      orgId,
      `SELECT COUNT(*)::text AS open
         FROM email_missing_purchase_orders
        WHERE organization_id = $1
          AND pile IN ('inbox','upload')
          ${filterSql}`,
      params,
    );

    const openTruncated = openRes.rows.length > MAX_OPEN;
    const doneTruncated = doneRes.rows.length > MAX_DONE;

    return NextResponse.json({
      success: true,
      open: {
        items: openRes.rows.slice(0, MAX_OPEN),
        count: Number(countRes.rows[0]?.open ?? 0),
        truncated: openTruncated,
      },
      done: {
        items: doneRes.rows.slice(0, MAX_DONE),
        truncated: doneTruncated,
      },
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving-lines/incoming/todo');
  }
}, { permission: 'receiving.view' });

export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) throw ApiError.badRequest('id is required');
    if (typeof body.done !== 'boolean') {
      throw ApiError.badRequest('done (boolean) is required');
    }

    // Check-off = pile move, fully reversible:
    //   done:true  → 'done'  (resolved_at stamped if not already)
    //   done:false → 'inbox' (resolved_at cleared so it re-enters the FIFO)
    const nextPile = body.done ? 'done' : 'inbox';

    // Org-ownership gate via WHERE — another org's row matches nothing → 404.
    // Audit the toggle inside the same tenant transaction so the reversible
    // action always has a trail and can never half-commit.
    const result = await withTenantTransaction(orgId, async (client) => {
      const upd = await client.query<{ id: string; pile: string; resolved_at: string | null }>(
        `UPDATE email_missing_purchase_orders
            SET pile = $2,
                resolved_at = CASE WHEN $2 = 'done'
                                   THEN COALESCE(resolved_at, NOW())
                                   ELSE NULL END,
                zoho_uploaded_at = CASE WHEN $2 = 'done'
                                        THEN COALESCE(zoho_uploaded_at, NOW())
                                        ELSE zoho_uploaded_at END
          WHERE id = $1
            AND organization_id = $3
          RETURNING id, pile, resolved_at`,
        [id, nextPile, orgId],
      );
      if (!upd.rowCount) return null;
      await recordAudit(client, ctx, req, {
        source: 'receiving.incoming.todo',
        action: body.done
          ? AUDIT_ACTION.RECEIVING_TODO_CHECKED
          : AUDIT_ACTION.RECEIVING_TODO_UNCHECKED,
        entityType: AUDIT_ENTITY.EMAIL_MISSING_PO,
        entityId: id,
        extra: { pile: nextPile },
      });
      return upd.rows[0];
    });

    if (!result) throw ApiError.notFound('email_missing_purchase_orders', id);

    return NextResponse.json({ success: true, row: result });
  } catch (error) {
    return errorResponse(error, 'PATCH /api/receiving-lines/incoming/todo');
  }
}, { permission: 'receiving.view' });
