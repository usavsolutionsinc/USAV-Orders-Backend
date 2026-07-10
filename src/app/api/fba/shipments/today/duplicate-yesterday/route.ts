import { NextResponse } from 'next/server';
import { buildFbaPlanRefFromIsoDate } from '@/lib/fba/plan-ref';
import { publishFbaShipmentChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';

/**
 * POST /api/fba/shipments/today/duplicate-yesterday
 *
 * Copies all PLANNED items from yesterday's shipment into today's plan.
 * Creates today's plan if it doesn't exist.
 * Skips FNSKUs already in today's plan.
 */
export const POST = withAuth(async (_req, ctx) => {
  try {
    type DupResult =
      | { kind: 'not_found'; error: string }
      | { kind: 'ok'; todayId: number; todayRef: string; added: number; skipped: number };

    const outcome = await withTenantTransaction<DupResult>(ctx.organizationId, async (client) => {
      // ── 1. Find yesterday's shipment ─────────────────────────────────────────
      const yesterdayRes = await client.query(`
        SELECT id, shipment_ref FROM fba_shipments
        WHERE due_date = CURRENT_DATE - INTERVAL '1 day'
          AND status = 'PLANNED'
          AND organization_id = $1
        ORDER BY created_at DESC LIMIT 1
      `, [ctx.organizationId]);

      if (yesterdayRes.rows.length === 0) {
        return { kind: 'not_found', error: 'No plan found for yesterday' };
      }

      const yesterdayId = yesterdayRes.rows[0].id;

      // ── 2. Get yesterday's items ──────────────────────────────────────────────
      const itemsRes = await client.query(
        `SELECT fnsku, expected_qty, product_title, asin, sku
         FROM fba_shipment_items WHERE shipment_id = $1 AND organization_id = $2`,
        [yesterdayId, ctx.organizationId]
      );

      if (itemsRes.rows.length === 0) {
        return { kind: 'not_found', error: 'Yesterday\'s plan has no items' };
      }

      // ── 3. Find or create today's shipment ───────────────────────────────────
      let todayRes = await client.query(`
        SELECT id, shipment_ref FROM fba_shipments
        WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
          AND organization_id = $1
        ORDER BY created_at DESC LIMIT 1
      `, [ctx.organizationId]);

      let todayId: number;
      let todayRef: string;

      if (todayRes.rows.length === 0) {
        const todayIso = await client.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
        const ref = buildFbaPlanRefFromIsoDate(String(todayIso.rows[0]?.d || ''));
        const newRes = await client.query(
          `INSERT INTO fba_shipments (shipment_ref, due_date, status, organization_id)
           VALUES ($1, CURRENT_DATE, 'PLANNED', $2) RETURNING id, shipment_ref`,
          [ref, ctx.organizationId]
        );
        todayId = newRes.rows[0].id;
        todayRef = newRes.rows[0].shipment_ref;
      } else {
        todayId = todayRes.rows[0].id;
        todayRef = todayRes.rows[0].shipment_ref;
      }

      // ── 4. Load existing FNSKUs in today's plan ──────────────────────────────
      const existingRes = await client.query(
        `SELECT fnsku FROM fba_shipment_items WHERE shipment_id = $1 AND organization_id = $2`,
        [todayId, ctx.organizationId]
      );
      const existingSet = new Set<string>(existingRes.rows.map((r: any) => r.fnsku));

      // ── 5. Insert new items ──────────────────────────────────────────────────
      const added: string[] = [];
      const skipped: string[] = [];

      for (const item of itemsRes.rows) {
        if (existingSet.has(item.fnsku)) { skipped.push(item.fnsku); continue; }
        const newItemRes = await client.query(
          `INSERT INTO fba_shipment_items (shipment_id, fnsku, expected_qty, product_title, asin, sku, status, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'PLANNED', $7) RETURNING id`,
          [todayId, item.fnsku, item.expected_qty, item.product_title, item.asin, item.sku, ctx.organizationId]
        );
        const newItemId: number = newItemRes.rows[0].id;

        await client.query(
          `INSERT INTO work_assignments
             (organization_id, entity_type, entity_id, work_type, status, priority, deadline_at)
           VALUES ($1, 'FBA_SHIPMENT', $2, 'PACK', 'OPEN', 1,
                   (CURRENT_DATE + INTERVAL '23 hours 59 minutes 59 seconds')::timestamptz)`,
          [ctx.organizationId, newItemId]
        );

        added.push(item.fnsku);
        existingSet.add(item.fnsku);
      }

      await client.query(
        `UPDATE fba_shipments SET updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [todayId, ctx.organizationId]
      );

      return { kind: 'ok', todayId, todayRef, added: added.length, skipped: skipped.length };
    });

    if (outcome.kind === 'not_found') {
      return NextResponse.json({ success: false, error: outcome.error }, { status: 404 });
    }

    await invalidateCacheTags(['fba-board', 'fba-shipments', 'fba-stage-counts']);
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts]);
    await publishFbaShipmentChanged({ action: 'duplicated', shipmentId: Number(outcome.todayId || 0), source: 'fba.shipments.duplicate', organizationId: ctx.organizationId });

    return NextResponse.json({
      success: true,
      shipment_id: outcome.todayId,
      shipment_ref: outcome.todayRef,
      plan_ref: outcome.todayRef,
      added: outcome.added,
      skipped: outcome.skipped,
    });
  } catch (error: any) {
    console.error('[POST /api/fba/shipments/today/duplicate-yesterday]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed' }, { status: 500 });
  }
}, {
  permission: 'fba.stage_shipments',
  feature: 'fba',
  audit: {
    source: 'fba.shipments.duplicate-yesterday',
    action: 'fba.shipment.duplicate_yesterday',
    entityType: 'fba_shipment',
    entityId: ({ response }) => {
      const r = response as { shipment?: { id?: number } } | null;
      return r?.shipment?.id ?? null;
    },
  },
});
