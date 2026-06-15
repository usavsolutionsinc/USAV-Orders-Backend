import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/alerts
 *
 * Read endpoint for the Alerts sidebar tab. Lists stock_alerts joined to
 * locations (for bin barcode), filterable by:
 *   q          — substring across sku / bin barcode / alert_type
 *   field      — narrows q to one of: sku | bin | rule
 *   bucket     — repeatable / comma-separated:
 *                 low_stock | stale_count | never_counted | drift | unresolved
 *   limit      — default 100, max 500
 *
 * Returns:
 *   { success, items: AlertRow[], counts: { low_stock, stale_count, never_counted, drift, unresolved, total } }
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
    try {
        const sp = req.nextUrl.searchParams;
        const q = (sp.get('q') ?? '').trim();
        const field = (sp.get('field') ?? 'all').trim().toLowerCase();
        const buckets = readBuckets(sp.getAll('bucket'));
        const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100), 1), 500);

        const where: string[] = [];
        const params: unknown[] = [];

        // Tenant ownership filter — never return another org's alerts.
        params.push(ctx.organizationId);
        where.push(`a.organization_id = $${params.length}`);

        if (q) {
            params.push(`%${q}%`);
            const idx = params.length;
            if (field === 'sku') where.push(`a.sku ILIKE $${idx}`);
            else if (field === 'bin') where.push(`l.barcode ILIKE $${idx}`);
            else if (field === 'rule') where.push(`a.alert_type ILIKE $${idx}`);
            else {
                where.push(`(a.sku ILIKE $${idx} OR l.barcode ILIKE $${idx} OR a.alert_type ILIKE $${idx})`);
            }
        }

        // Map bucket ids → alert_type / resolved state.
        const typeFilters = new Set<string>();
        let onlyUnresolved = false;
        for (const b of buckets) {
            if (b === 'low_stock') typeFilters.add('LOW_STOCK');
            else if (b === 'stale_count') typeFilters.add('STALE_COUNT');
            else if (b === 'never_counted') typeFilters.add('NEVER_COUNTED');
            else if (b === 'drift') typeFilters.add('DRIFT');
            else if (b === 'unresolved') onlyUnresolved = true;
        }
        if (typeFilters.size > 0) {
            params.push(Array.from(typeFilters));
            where.push(`a.alert_type = ANY($${params.length}::text[])`);
        }
        if (onlyUnresolved) where.push(`a.resolved_at IS NULL`);

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(limit);
        const limitIdx = params.length;

        const listSql = `
            SELECT
                a.id,
                a.sku,
                a.bin_id,
                l.barcode AS bin_barcode,
                a.alert_type AS rule,
                COALESCE(a.threshold, 0) AS threshold,
                a.qty_at_trigger,
                a.triggered_at AS raised_at,
                a.resolved_at,
                a.notes,
                CASE
                    WHEN a.alert_type = 'LOW_STOCK' THEN 'warning'
                    WHEN a.alert_type = 'NEVER_COUNTED' THEN 'critical'
                    WHEN a.alert_type = 'STALE_COUNT' THEN 'warning'
                    WHEN a.alert_type = 'DRIFT' THEN 'critical'
                    ELSE 'info'
                END AS severity
            FROM stock_alerts a
            LEFT JOIN locations l ON l.id = a.bin_id
            ${whereClause}
            ORDER BY a.resolved_at NULLS FIRST, a.triggered_at DESC
            LIMIT $${limitIdx}
        `;

        const countsSql = `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE a.alert_type = 'LOW_STOCK')::int AS low_stock,
                COUNT(*) FILTER (WHERE a.alert_type = 'STALE_COUNT')::int AS stale_count,
                COUNT(*) FILTER (WHERE a.alert_type = 'NEVER_COUNTED')::int AS never_counted,
                COUNT(*) FILTER (WHERE a.alert_type = 'DRIFT')::int AS drift,
                COUNT(*) FILTER (WHERE a.resolved_at IS NULL)::int AS unresolved
            FROM stock_alerts a
            WHERE a.organization_id = $1
        `;

        const [listResult, countsResult] = await Promise.all([
            tenantQuery(ctx.organizationId, listSql, params),
            tenantQuery(ctx.organizationId, countsSql, [ctx.organizationId]),
        ]);

        return NextResponse.json({
            success: true,
            items: listResult.rows,
            counts: countsResult.rows[0] ?? {
                total: 0,
                low_stock: 0,
                stale_count: 0,
                never_counted: 0,
                drift: 0,
                unresolved: 0,
            },
        });
    } catch (err: any) {
        console.error('[GET /api/inventory/alerts] error:', err);
        return NextResponse.json(
            { success: false, error: err?.message || 'Failed to load alerts' },
            { status: 500 },
        );
    }
}, { permission: 'sku_stock.view' });

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
