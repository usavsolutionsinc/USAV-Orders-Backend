import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseFilters } from '@/lib/audit-log/filters';
import {
  getPackingTrackingDetail,
  listPackingTrackings,
} from '@/lib/audit-log/packing-aggregator';

/**
 * GET /api/audit-log/packing
 *   ?tracking=<value>  → full timeline for one tracking
 *   no `tracking`      → most-recent packer events grouped by tracking
 *
 * Shared filters (day/start/end/staffId/sku/q) apply in both modes.
 * Gate: admin.view_logs.
 */
export const GET = withAuth(
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const filters = parseFilters(searchParams);
    const tracking = searchParams.get('tracking')?.trim() || null;

    try {
      if (tracking) {
        const detail = await getPackingTrackingDetail(tracking, filters);
        if (!detail) {
          return NextResponse.json(
            { success: false, error: 'Tracking not found' },
            { status: 404 },
          );
        }
        return NextResponse.json({ success: true, ...detail });
      }

      const items = await listPackingTrackings({
        filters,
        search: filters.q,
      });
      return NextResponse.json({ success: true, items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'audit-log/packing read failed';
      console.error('audit-log/packing GET failed:', err);
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  },
  { permission: 'admin.view_logs' },
);
