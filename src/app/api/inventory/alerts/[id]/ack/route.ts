import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/alerts/[id]/ack
 *
 * Acknowledges a stock_alerts row — sets resolved_at = NOW() and optionally
 * stores a free-text note. Idempotent: re-acking an already-resolved alert
 * is a no-op (the existing resolved_at is preserved).
 *
 * Body: { note?: string }
 *
 * Note: `withAuth` does not forward Next.js dynamic route params; we parse
 * `id` from `request.nextUrl.pathname` instead, matching the pattern used
 * by /api/serial-units/[id]/hold.
 */
export const POST = withAuth(async (request) => {
    try {
        const segments = request.nextUrl.pathname.split('/').filter(Boolean);
        // .../api/inventory/alerts/[id]/ack → id is segments[-2]
        const idStr = segments[segments.length - 2];
        const alertId = Number(idStr);
        if (!Number.isFinite(alertId) || alertId <= 0) {
            return NextResponse.json({ success: false, error: 'Invalid alert id' }, { status: 400 });
        }

        let note: string | null = null;
        try {
            const body = await request.json();
            if (typeof body?.note === 'string') note = body.note.trim() || null;
        } catch {
            /* empty body is fine */
        }

        const result = await pool.query(
            `UPDATE stock_alerts
             SET resolved_at = COALESCE(resolved_at, NOW()),
                 notes = COALESCE($2, notes)
             WHERE id = $1
             RETURNING id, sku, bin_id, alert_type, triggered_at, resolved_at, notes`,
            [alertId, note],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ success: false, error: 'Alert not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, alert: result.rows[0] });
    } catch (err: any) {
        console.error('[POST /api/inventory/alerts/[id]/ack] error:', err);
        return NextResponse.json(
            { success: false, error: err?.message || 'Failed to ack alert' },
            { status: 500 },
        );
    }
}, { permission: 'stock_alerts.ack' });
