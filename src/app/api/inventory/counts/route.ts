import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/counts
 *
 * Read endpoint for the Counts sidebar tab. Lists cycle_count_campaigns
 * with aggregated line progress, filterable by:
 *   q       — substring on campaign name
 *   bucket  — repeatable / comma-separated:
 *             open | in_progress | reconciling | closed
 *   limit   — default 50, max 200
 *
 * Returns:
 *   { success, items: CountRow[], counts: { open, in_progress, reconciling, closed, total } }
 */
export const GET = withAuth(async (req: NextRequest) => {
    try {
        const sp = req.nextUrl.searchParams;
        const q = (sp.get('q') ?? '').trim();
        const buckets = readBuckets(sp.getAll('bucket'));
        const limit = Math.min(Math.max(Number(sp.get('limit') ?? 50), 1), 200);

        const where: string[] = [];
        const params: unknown[] = [];

        if (q) {
            params.push(`%${q}%`);
            where.push(`c.name ILIKE $${params.length}`);
        }
        if (buckets.length > 0) {
            // 'reconciling' is a derived status — campaigns with any pending_review lines.
            const explicit = buckets.filter((b) => b !== 'reconciling');
            if (explicit.length > 0) {
                params.push(explicit);
                where.push(`derived_status = ANY($${params.length}::text[])`);
            }
            if (buckets.includes('reconciling')) {
                where.push(`derived_status = 'reconciling'`);
            }
        }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        params.push(limit);
        const limitIdx = params.length;

        const listSql = `
            WITH base AS (
                SELECT
                    c.id,
                    c.name,
                    c.status,
                    c.created_at AS opened_at,
                    c.closed_at,
                    COALESCE(c.scope->>'zone', NULL) AS zone,
                    COUNT(line.id)::int AS line_count,
                    COUNT(line.id) FILTER (WHERE line.status = 'pending')::int AS pending_count,
                    COUNT(line.id) FILTER (WHERE line.status = 'counted')::int AS counted_count,
                    COUNT(line.id) FILTER (WHERE line.status = 'pending_review')::int AS review_count,
                    COUNT(line.id) FILTER (WHERE line.status IN ('approved','rejected'))::int AS resolved_count
                FROM cycle_count_campaigns c
                LEFT JOIN cycle_count_lines line ON line.campaign_id = c.id
                GROUP BY c.id
            )
            SELECT
                id, name, status, opened_at, closed_at, zone,
                line_count, pending_count, counted_count, review_count, resolved_count,
                CASE
                    WHEN line_count = 0 THEN NULL
                    ELSE LEAST(GREATEST((counted_count + resolved_count)::float / line_count::float, 0.0), 1.0)
                END AS progress_pct,
                CASE
                    WHEN status = 'closed' THEN 'closed'
                    WHEN review_count > 0 THEN 'reconciling'
                    WHEN counted_count + resolved_count > 0 THEN 'in_progress'
                    ELSE 'open'
                END AS derived_status
            FROM base
            ${whereClause}
            ORDER BY closed_at DESC NULLS FIRST, opened_at DESC
            LIMIT $${limitIdx}
        `;

        const result = await pool.query(listSql, params);
        const rows = result.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            status: r.derived_status,
            zone: r.zone,
            line_count: r.line_count,
            progress_pct: r.progress_pct == null ? null : Number(r.progress_pct),
            opened_at: r.opened_at,
            closed_at: r.closed_at,
        }));

        // Counts pass — separate query against derived statuses for badge tallies.
        const countsResult = await pool.query(
            `
            WITH base AS (
                SELECT
                    c.id, c.status,
                    COUNT(line.id) FILTER (WHERE line.status = 'pending_review')::int AS review_count,
                    COUNT(line.id) FILTER (WHERE line.status IN ('counted','approved','rejected'))::int AS progress_count
                FROM cycle_count_campaigns c
                LEFT JOIN cycle_count_lines line ON line.campaign_id = c.id
                GROUP BY c.id
            )
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
                COUNT(*) FILTER (WHERE status <> 'closed' AND review_count > 0)::int AS reconciling,
                COUNT(*) FILTER (WHERE status <> 'closed' AND review_count = 0 AND progress_count > 0)::int AS in_progress,
                COUNT(*) FILTER (WHERE status <> 'closed' AND review_count = 0 AND progress_count = 0)::int AS open
            FROM base
            `,
        );

        return NextResponse.json({
            success: true,
            items: rows,
            counts: countsResult.rows[0] ?? {
                total: 0,
                open: 0,
                in_progress: 0,
                reconciling: 0,
                closed: 0,
            },
        });
    } catch (err: any) {
        console.error('[GET /api/inventory/counts] error:', err);
        return NextResponse.json(
            { success: false, error: err?.message || 'Failed to load cycle counts' },
            { status: 500 },
        );
    }
}, { permission: 'cycle_count.view' });

function readBuckets(raw: string[]): string[] {
    const out = new Set<string>();
    for (const v of raw) {
        for (const part of v.split(',')) {
            const trimmed = part.trim().toLowerCase();
            if (trimmed) out.add(trimmed);
        }
    }
    return Array.from(out);
}
