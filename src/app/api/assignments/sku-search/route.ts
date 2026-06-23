import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';

/**
 * GET /api/assignments/sku-search?q=<term>&staff_id=<id>&limit=50
 *
 * Search-first SKU assignment workflow.
 * Returns only the matching sku_stock rows (up to `limit`) joined with
 * their current active work_assignment (if any).
 *
 * - q          : search term against sku + product_title (required, min 1 char)
 * - staff_id   : optional — filter to SKUs already assigned to this staff member
 * - unassigned : "true" — filter to only SKUs with no active WA (open pool)
 * - limit      : max rows (1–200, default 50)
 *
 * This intentionally never returns all unassigned rows without a query,
 * preventing the "ping all 500" problem.
 */
async function handleGet(req: NextRequest, ctx: { organizationId: string }) {
  try {
    const { searchParams } = new URL(req.url);
    const q           = String(searchParams.get('q') || '').trim();
    const staffIdRaw  = Number(searchParams.get('staff_id'));
    const staffId     = Number.isFinite(staffIdRaw) && staffIdRaw > 0 ? staffIdRaw : null;
    const unassigned  = searchParams.get('unassigned') === 'true';
    const limitRaw    = parseInt(searchParams.get('limit') || '50', 10);
    const limit       = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    // Require at least a search term OR a staff_id filter — never return the full pool blind
    if (!q && !staffId && !unassigned) {
      return NextResponse.json(
        { success: false, error: 'Provide q (search), staff_id, or unassigned=true to filter results' },
        { status: 400 }
      );
    }

    const params: any[] = [];
    const where: string[] = [];

    // Tenant scope on sku_stock — explicit predicate is defense-in-depth on top
    // of the GUC backstop applied by tenantQuery() below.
    params.push(ctx.organizationId);
    const orgParam = params.length;
    where.push(`ss.organization_id = $${orgParam}`);

    if (q) {
      params.push(`%${q}%`);
      where.push(`(ss.sku ILIKE $${params.length} OR ss.product_title ILIKE $${params.length})`);
    }

    // Assignment filter
    if (staffId) {
      params.push(staffId);
      where.push(`wa.assigned_tech_id = $${params.length}`);
    } else if (unassigned) {
      // Only rows with no active WA at all
      where.push(`wa.id IS NULL`);
    }

    params.push(limit);
    const sql = `
      SELECT
        ss.id          AS sku_stock_id,
        ss.sku,
        ss.product_title,
        ss.stock,
        wa.id          AS wa_id,
        wa.status      AS wa_status,
        wa.assigned_tech_id,
        wa.assigned_packer_id,
        st.name        AS assigned_tech_name,
        sp.name        AS assigned_packer_name,
        wa.priority,
        wa.deadline_at,
        wa.notes       AS wa_notes,
        wa.assigned_at,
        wa.started_at,
        wa.completed_at
      FROM sku_stock ss
      LEFT JOIN LATERAL (
        SELECT *
        FROM work_assignments
        WHERE entity_type = 'SKU_STOCK'
          AND entity_id   = ss.id
          AND work_type   = 'STOCK_REPLENISH'
          AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
          AND organization_id = $${orgParam}
        ORDER BY id DESC
        LIMIT 1
      ) wa ON true
      LEFT JOIN staff st ON st.id = wa.assigned_tech_id
      LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE wa.status
          WHEN 'IN_PROGRESS' THEN 1
          WHEN 'ASSIGNED'    THEN 2
          WHEN 'OPEN'        THEN 3
          ELSE                    4
        END,
        ss.sku ASC
      LIMIT $${params.length}
    `;

    const result = await tenantQuery(ctx.organizationId, sql, params);

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      items: result.rows,
    });
  } catch (error: any) {
    console.error('GET /api/assignments/sku-search error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to search SKU assignments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/assignments/sku-search
 *
 * Assign or re-assign a sku_stock row to workers, or clear the assignment.
 *
 * Body:
 *   sku_stock_id : number        (required)
 *   tech_id      : number | null — technician (null to clear)
 *   packer_id    : number | null — packer     (null to clear)
 *   priority     : number        (optional, default 100)
 *   notes        : string        (optional)
 *   deadline_at  : string        (optional ISO date)
 */
async function handlePost(req: NextRequest, ctx: { organizationId: string }) {
  try {
    const body        = await req.json();
    const skuStockId  = Number(body?.sku_stock_id);
    const techIdRaw   = body?.tech_id   == null ? null : Number(body.tech_id);
    const packerIdRaw = body?.packer_id == null ? null : Number(body.packer_id);
    const techId      = techIdRaw   != null && Number.isFinite(techIdRaw)   && techIdRaw   > 0 ? techIdRaw   : null;
    const packerId    = packerIdRaw != null && Number.isFinite(packerIdRaw) && packerIdRaw > 0 ? packerIdRaw : null;
    const priorityRaw = Number(body?.priority);
    const priority    = Number.isFinite(priorityRaw) && priorityRaw > 0 ? Math.min(priorityRaw, 9999) : 100;
    const notes       = body?.notes       != null ? String(body.notes).trim()      || null : null;
    const deadlineAt  = body?.deadline_at != null ? String(body.deadline_at).trim() || null : null;

    if (!Number.isFinite(skuStockId) || skuStockId <= 0) {
      return NextResponse.json({ success: false, error: 'Valid sku_stock_id is required' }, { status: 400 });
    }

    // ASSIGNED once either slot is filled; OPEN when both are cleared
    const newStatus = (techId || packerId) ? 'ASSIGNED' : 'OPEN';

    const result = await withTenantTransaction(ctx.organizationId, async (client) => {
      const skuRow = await client.query(
        `SELECT id FROM sku_stock WHERE id = $1 AND organization_id = $2`,
        [skuStockId, ctx.organizationId]
      );
      if (skuRow.rows.length === 0) {
        return { notFound: true as const };
      }

      const existing = await client.query(
        `SELECT id, assigned_tech_id FROM work_assignments
         WHERE entity_type = 'SKU_STOCK'
           AND entity_id   = $1
           AND work_type   = 'STOCK_REPLENISH'
           AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
           AND organization_id = $2
         ORDER BY id DESC LIMIT 1`,
        [skuStockId, ctx.organizationId]
      );

      let wa;
      if (existing.rows.length > 0) {
        const r = await client.query(
          `UPDATE work_assignments
           SET assigned_tech_id   = $1,
               assigned_packer_id = $2,
               status             = $3,
               priority           = $4,
               notes              = COALESCE($5, notes),
               deadline_at        = COALESCE($6, deadline_at),
               assigned_at        = CASE
                                      WHEN $1 IS NOT NULL
                                       AND assigned_tech_id IS DISTINCT FROM $1
                                      THEN NOW()
                                      ELSE assigned_at
                                    END,
               updated_at         = NOW()
           WHERE id = $7 AND organization_id = $8
           RETURNING *`,
          [techId, packerId, newStatus, priority, notes, deadlineAt, existing.rows[0].id, ctx.organizationId]
        );
        wa = r.rows[0];
      } else {
        // organization_id is stamped by the column default from the GUC
        // (app.current_org) set by withTenantTransaction.
        const r = await client.query(
          `INSERT INTO work_assignments
             (entity_type, entity_id, work_type, assigned_tech_id, assigned_packer_id,
              status, priority, notes, deadline_at, assigned_at)
           VALUES
             ('SKU_STOCK', $1, 'STOCK_REPLENISH', $2, $3, $4, $5, $6, $7,
              CASE WHEN $2 IS NOT NULL OR $3 IS NOT NULL THEN NOW() ELSE NULL END)
           RETURNING *`,
          [skuStockId, techId, packerId, newStatus, priority, notes, deadlineAt]
        );
        wa = r.rows[0];
      }

      // Fetch names for response
      const [techRow, packerRow] = await Promise.all([
        techId   ? client.query(`SELECT name FROM staff WHERE id = $1 AND organization_id = $2`, [techId, ctx.organizationId])   : Promise.resolve({ rows: [] }),
        packerId ? client.query(`SELECT name FROM staff WHERE id = $1 AND organization_id = $2`, [packerId, ctx.organizationId]) : Promise.resolve({ rows: [] }),
      ]);

      return {
        wa,
        techName:   techRow.rows[0]?.name   ?? null,
        packerName: packerRow.rows[0]?.name ?? null,
      };
    });

    if ('notFound' in result) {
      return NextResponse.json({ success: false, error: 'sku_stock_id not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      assignment: {
        ...result.wa,
        assigned_tech_name:   result.techName,
        assigned_packer_name: result.packerName,
      },
    });
  } catch (error: any) {
    console.error('POST /api/assignments/sku-search error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to assign SKU' },
      { status: 500 }
    );
  }
}

// Phase 2e: both GET and POST require work_orders.view — this is the SKU
// search backing the work-assignment workflow.
export const GET = withAuth(handleGet, { permission: 'work_orders.view' });
export const POST = withAuth(handlePost, { permission: 'work_orders.view' });
