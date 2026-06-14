import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { withAuth } from '@/lib/auth/withAuth';
import { db } from '@/lib/drizzle/db';
import { stationDefinitions } from '@/lib/drizzle/schema';
import {
  SLOT_IDS,
  listActionMeta,
  listBlockMeta,
  listDataSourceMeta,
  type BlockInstanceConfig,
} from '@/lib/stations';

/**
 * GET /api/studio/nodes/[id]/station
 *
 * The read-only L2 "station detail" feed (Operations Studio). Returns the
 * ACTIVE station_definition bound to a workflow node instance
 * (station_definitions.workflow_node_id = id), enriched on the server with the
 * block / data-source / action registry metadata so the client renders a
 * dependency-free, render-ready slot → block view. `{ station: null }` when the
 * node has no station bound. Read-only — editing lives behind studio.manage in
 * a later phase (Studio law #6: drafts only, publish atomically).
 */
export const dynamic = 'force-dynamic';

export const GET = withAuth(
  async (request, ctx) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../api/studio/nodes/[id]/station → id is segments[-2]
    const nodeId = decodeURIComponent(segments[segments.length - 2] ?? '');
    if (!nodeId) {
      return NextResponse.json({ ok: false, error: 'invalid node id' }, { status: 400 });
    }

    try {
      const rows = await db
        .select({
          id: stationDefinitions.id,
          label: stationDefinitions.label,
          pageKey: stationDefinitions.pageKey,
          modeKey: stationDefinitions.modeKey,
          workflowNodeId: stationDefinitions.workflowNodeId,
          config: stationDefinitions.config,
          version: stationDefinitions.version,
          isActive: stationDefinitions.isActive,
        })
        .from(stationDefinitions)
        .where(
          and(
            eq(stationDefinitions.organizationId, ctx.organizationId),
            eq(stationDefinitions.workflowNodeId, nodeId),
            eq(stationDefinitions.isActive, true),
          ),
        )
        .orderBy(desc(stationDefinitions.version))
        .limit(1);

      const row = rows[0] ?? null;
      if (!row) {
        return NextResponse.json({ ok: true, station: null });
      }

      // Registry metadata (CODE) → resolve labels/icons/endpoints for the
      // saved composition (DATA). Maps built once per request.
      const blockMeta = new Map(listBlockMeta().map((b) => [b.type, b]));
      const sourceMeta = new Map(listDataSourceMeta().map((s) => [s.id, s]));
      const actionMeta = new Map(listActionMeta().map((a) => [a.id, a]));

      const rawConfig = (row.config ?? {}) as {
        slots?: Record<string, BlockInstanceConfig[]> | 'legacy';
      };
      const legacy = rawConfig.slots === 'legacy';
      const slotsConfig =
        legacy || !rawConfig.slots ? null : (rawConfig.slots as Record<string, BlockInstanceConfig[]>);

      const slots = slotsConfig
        ? SLOT_IDS.map((slot) => {
            const instances = slotsConfig[slot] ?? [];
            return {
              slot,
              blocks: instances.map((b) => {
                const bm = blockMeta.get(b.block) ?? null;
                const sm = b.source ? sourceMeta.get(b.source.id) ?? null : null;
                return {
                  id: b.id,
                  block: b.block,
                  blockLabel: bm?.label ?? b.block,
                  blockIcon: bm?.icon ?? 'Box',
                  source: sm
                    ? {
                        id: sm.id,
                        label: sm.label,
                        integration: sm.integration,
                        endpoint: sm.endpoint,
                        realtimeChannel: sm.realtime?.ablyChannel ?? null,
                      }
                    : null,
                  fields: b.source?.fields ?? {},
                  actions: (b.actions ?? []).map((id) => {
                    const am = actionMeta.get(id) ?? null;
                    return { id, label: am?.label ?? id, icon: am?.icon ?? 'Zap' };
                  }),
                  doneWhen: b.done_when ?? null,
                };
              }),
            };
          }).filter((s) => s.blocks.length > 0)
        : [];

      return NextResponse.json({
        ok: true,
        station: {
          id: row.id,
          label: row.label,
          pageKey: row.pageKey,
          modeKey: row.modeKey,
          workflowNodeId: row.workflowNodeId,
          version: row.version,
          isActive: row.isActive,
          legacy,
          slots,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'studio station failed';
      console.error('[GET /api/studio/nodes/[id]/station] error:', err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  },
  { permission: 'studio.view' },
);
