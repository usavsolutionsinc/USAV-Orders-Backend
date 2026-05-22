/**
 * GET /api/admin/po-gmail/triage
 *
 * Single-shot fetch for the sidebar pile view. Returns every email
 * worklist row grouped by pile, with per-pile counts.
 *
 * Each pile is capped at MAX_PER_PILE to keep payload + render cost
 * bounded — Done historically dominates after a few months. The
 * sidebar lazy-paginates beyond the cap.
 *
 * The legacy PATCH endpoint at /api/admin/po-gmail/missing-orders is
 * superseded by /api/admin/po-gmail/triage/[id] but stays around until
 * its callers are removed (PoMailboxPreviewPanel still uses it).
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

const PILES = ['inbox', 'upload', 'ignore', 'done'] as const;
type Pile = (typeof PILES)[number];

const MAX_PER_PILE = 100;

interface Row {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  po_numbers: string[];
  po_numbers_norm: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  pile: Pile;
  status: string;
  notes: string | null;
  assigned_to: string | null;
  zoho_uploaded_po_number: string | null;
  zoho_uploaded_at: string | null;
  triage_state: Record<string, unknown>;
  resolved_at: string | null;
}

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    // One query, partitioned per pile via row_number — cheaper than four
    // round trips and stays under MAX_PER_PILE per group.
    const { rows } = await pool.query<Row>(
      `WITH ranked AS (
         SELECT *,
                row_number() OVER (PARTITION BY pile ORDER BY scanned_at DESC) AS rn
           FROM email_missing_purchase_orders
       )
       SELECT id, gmail_msg_id, gmail_thread_id, po_numbers, po_numbers_norm,
              email_subject, email_from, email_received, scanned_at,
              pile, status, notes, assigned_to,
              zoho_uploaded_po_number, zoho_uploaded_at,
              triage_state, resolved_at
         FROM ranked
        WHERE rn <= $1
        ORDER BY pile, scanned_at DESC`,
      [MAX_PER_PILE],
    );

    const counts = await pool.query<{ pile: Pile; n: string }>(
      `SELECT pile, COUNT(*)::text AS n
         FROM email_missing_purchase_orders
        GROUP BY pile`,
    );

    const piles: Record<Pile, { items: Row[]; count: number; truncated: boolean }> = {
      inbox:  { items: [], count: 0, truncated: false },
      upload: { items: [], count: 0, truncated: false },
      ignore: { items: [], count: 0, truncated: false },
      done:   { items: [], count: 0, truncated: false },
    };

    for (const r of rows) {
      if (piles[r.pile]) piles[r.pile].items.push(r);
    }
    for (const c of counts.rows) {
      if (piles[c.pile]) {
        piles[c.pile].count = Number(c.n);
        piles[c.pile].truncated = Number(c.n) > MAX_PER_PILE;
      }
    }

    return NextResponse.json({ piles, maxPerPile: MAX_PER_PILE });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-gmail/triage');
  }
}, { permission: 'admin.view' });
