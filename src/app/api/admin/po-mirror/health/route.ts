/**
 * GET /api/admin/po-mirror/health
 *
 * Lightweight read used by the inventory sidebar to confirm the Zoho
 * mirror (receiving_lines) is staying fresh. Returns counts + freshness
 * markers + last cursor advance — no Zoho API call.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface MirrorRow {
  total_pos: string;
  last_synced_at: string | null;
}

interface CursorRow {
  last_synced_at: string | null;
}

interface WorklistRow {
  pending: string;
  ignored: string;
  resolved: string;
}

export const GET = withAuth(async () => {
  try {
    const [mirror, cursor, worklist] = await Promise.all([
      pool.query<MirrorRow>(
        `SELECT
           COUNT(*)::text       AS total_pos,
           MAX(last_synced_at)  AS last_synced_at
         FROM zoho_po_mirror`,
      ),
      pool.query<CursorRow>(
        `SELECT last_synced_at FROM sync_cursors WHERE resource = 'zoho_po_mirror' LIMIT 1`,
      ),
      pool.query<WorklistRow>(
        `SELECT
           COUNT(*) FILTER (WHERE status='pending')::text  AS pending,
           COUNT(*) FILTER (WHERE status='ignored')::text  AS ignored,
           COUNT(*) FILTER (WHERE status='resolved')::text AS resolved
         FROM email_missing_orders`,
      ),
    ]);

    const m = mirror.rows[0];
    const lastSyncedAt = m?.last_synced_at ? new Date(m.last_synced_at).toISOString() : null;
    const ageMs = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : null;

    return NextResponse.json({
      mirror: {
        totalPurchaseOrders: Number(m?.total_pos ?? 0),
        lastSyncedAt,
        ageMs,
      },
      cron: {
        lastCursorAdvance: cursor.rows[0]?.last_synced_at ?? null,
      },
      worklist: {
        pending: Number(worklist.rows[0]?.pending ?? 0),
        ignored: Number(worklist.rows[0]?.ignored ?? 0),
        resolved: Number(worklist.rows[0]?.resolved ?? 0),
      },
    });
  } catch (error) {
    return errorResponse(error, 'GET /api/admin/po-mirror/health');
  }
}, { permission: 'admin.view' });
