import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { publishFbaItemChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';

const VALID_STAGES = ['TECH', 'PACK', 'SHIP', 'ADMIN'] as const;
const VALID_EVENTS = ['SCANNED', 'READY', 'VERIFIED', 'BOXED', 'ASSIGNED', 'SHIPPED', 'UNASSIGNED', 'VOID'] as const;

type SourceStage = (typeof VALID_STAGES)[number];
type EventType = (typeof VALID_EVENTS)[number];

// ── GET /api/fba/logs ─────────────────────────────────────────────────────────
// List fba_fnsku_logs with optional filters.
// Query params: fnsku, source_stage, event_type, staff_id, fba_shipment_id,
//               from (ISO date), to (ISO date), limit, offset
export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);

    const fnsku = searchParams.get('fnsku')?.trim().toUpperCase() || null;
    const sourceStage = searchParams.get('source_stage')?.trim().toUpperCase() || null;
    const eventType = searchParams.get('event_type')?.trim().toUpperCase() || null;
    const staffId = searchParams.get('staff_id') ? Number(searchParams.get('staff_id')) : null;
    const shipmentId = searchParams.get('fba_shipment_id')
      ? Number(searchParams.get('fba_shipment_id'))
      : null;
    const from = searchParams.get('from') || null;
    const to = searchParams.get('to') || null;
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 100;
    const offsetRaw = Number(searchParams.get('offset') || 0);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : 0;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    // Tenant ownership filter — never return another org's FBA logs.
    conditions.push(`l.organization_id = $${idx++}`);
    params.push(ctx.organizationId);

    if (fnsku) {
      conditions.push(`l.fnsku = $${idx++}`);
      params.push(fnsku);
    }
    if (sourceStage) {
      conditions.push(`l.source_stage = $${idx++}`);
      params.push(sourceStage);
    }
    if (eventType) {
      conditions.push(`l.event_type = $${idx++}`);
      params.push(eventType);
    }
    if (staffId && Number.isFinite(staffId)) {
      conditions.push(`l.staff_id = $${idx++}`);
      params.push(staffId);
    }
    if (shipmentId && Number.isFinite(shipmentId)) {
      conditions.push(`l.fba_shipment_id = $${idx++}`);
      params.push(shipmentId);
    }
    if (from) {
      conditions.push(`l.created_at >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`l.created_at <= $${idx++}`);
      params.push(to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);

    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT
         l.id,
         l.fnsku,
         l.source_stage,
         l.event_type,
         l.staff_id,
         s.name              AS staff_name,
         l.tech_serial_number_id,
         l.fba_shipment_id,
         fs.shipment_ref,
         l.fba_shipment_item_id,
         l.quantity,
         l.station,
         l.notes,
         l.metadata,
         l.created_at,
         ff.product_title,
         ff.asin,
         ff.sku
       FROM fba_fnsku_logs l
       LEFT JOIN staff s               ON s.id   = l.staff_id
       LEFT JOIN fba_fnskus ff         ON ff.fnsku = l.fnsku AND ff.organization_id = l.organization_id
       LEFT JOIN fba_shipments fs      ON fs.id  = l.fba_shipment_id
       ${whereClause}
       ORDER BY l.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    return NextResponse.json({ success: true, logs: result.rows, count: result.rowCount });
  } catch (error: any) {
    console.error('[GET /api/fba/logs]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA logs' },
      { status: 500 }
    );
  }
}, { permission: 'fba.view' });

// ── POST /api/fba/logs ────────────────────────────────────────────────────────
// Manually insert an fba_fnsku_log entry.
// Useful for admin corrections, tech-station scans, and testing.
// Body: { fnsku, source_stage, event_type,
//         fba_shipment_id?, fba_shipment_item_id?, tech_serial_number_id?,
//         quantity?, station?, notes?, metadata? }
// Actor is from the verified session.
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();

    const fnsku = String(body?.fnsku || '').trim().toUpperCase();
    const sourceStage = String(body?.source_stage || '').trim().toUpperCase() as SourceStage;
    const eventType = String(body?.event_type || '').trim().toUpperCase() as EventType;
    const staffId = ctx.staffId;

    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }
    if (!VALID_STAGES.includes(sourceStage)) {
      return NextResponse.json(
        { success: false, error: `source_stage must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 }
      );
    }
    if (!VALID_EVENTS.includes(eventType)) {
      return NextResponse.json(
        { success: false, error: `event_type must be one of: ${VALID_EVENTS.join(', ')}` },
        { status: 400 }
      );
    }

    const txResult = await withTenantTransaction<
      | { ok: false; error: NextResponse }
      | { ok: true; log: any; fnskuMeta: any; staffName: any }
    >(ctx.organizationId, async (client) => {
      // Verify FNSKU exists (within this tenant)
      const fnskuCheck = await client.query(
        `SELECT fnsku, product_title, asin, sku FROM fba_fnskus WHERE fnsku = $1 AND organization_id = $2`,
        [fnsku, ctx.organizationId]
      );
      if (!fnskuCheck.rows[0]) {
        return {
          ok: false,
          error: NextResponse.json(
            { success: false, error: `FNSKU '${fnsku}' not found in fba_fnskus` },
            { status: 404 }
          ),
        };
      }

      // Verify staff exists
      const staffCheck = await client.query(`SELECT id, name FROM staff WHERE id = $1`, [staffId]);
      if (!staffCheck.rows[0]) {
        return {
          ok: false,
          error: NextResponse.json({ success: false, error: 'Staff not found' }, { status: 404 }),
        };
      }

      const quantity = Math.max(1, Number(body?.quantity) || 1);
      const shipmentId = body?.fba_shipment_id ? Number(body.fba_shipment_id) : null;
      const itemId = body?.fba_shipment_item_id ? Number(body.fba_shipment_item_id) : null;
      const techSerialId = body?.tech_serial_number_id ? Number(body.tech_serial_number_id) : null;
      const station = body?.station ? String(body.station).trim() : null;
      const notes = body?.notes ? String(body.notes).trim() : null;
      const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {};

      const result = await client.query(
        `INSERT INTO fba_fnsku_logs
           (fnsku, source_stage, event_type, staff_id, tech_serial_number_id,
            fba_shipment_id, fba_shipment_item_id, quantity, station, notes, metadata, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
         RETURNING *`,
        [
          fnsku,
          sourceStage,
          eventType,
          staffId,
          techSerialId,
          shipmentId,
          itemId,
          quantity,
          station,
          notes,
          JSON.stringify(metadata),
          ctx.organizationId,
        ]
      );

      return { ok: true, log: result.rows[0], fnskuMeta: fnskuCheck.rows[0], staffName: staffCheck.rows[0].name };
    });

    if (!txResult.ok) return txResult.error;

    await invalidateCacheTags(['fba-logs']);
    await publishFbaItemChanged({ action: 'scan', shipmentId: 0, source: 'fba.logs.create', organizationId: ctx.organizationId });

    return NextResponse.json(
      {
        success: true,
        log: txResult.log,
        fnsku_meta: txResult.fnskuMeta,
        staff_name: txResult.staffName,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[POST /api/fba/logs]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create FBA log' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.stage_shipments',
  audit: {
    source: 'fba.logs.create',
    action: 'fba.log.create',
    entityType: 'fba_fnsku_log',
    entityId: ({ response }) => {
      const r = response as { log?: { id?: number } } | null;
      return r?.log?.id ?? null;
    },
    extra: ({ body }) => {
      const b = body as { fnsku?: string; event_type?: string; source_stage?: string } | null;
      return {
        fnsku: b?.fnsku ?? null,
        event_type: b?.event_type ?? null,
        source_stage: b?.source_stage ?? null,
      };
    },
  },
});
