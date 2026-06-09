import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getHandlingUnitDetail, getHandlingUnitByCode } from '@/lib/neon/handling-unit-queries';

/**
 * GET /api/handling-units/:id — box + contents + rollup status.
 *
 * Accepts a numeric handling_units.id OR an `H-{id}` / external `code` in the
 * URL segment. Returns `handling_unit` with `units`, `receiving_line_ids` (what
 * the testing resolver fans out to), and a `rollup` { total, tested, untested }.
 */
export const GET = withAuth(
  async (request: NextRequest) => {
    const raw = extractIdSegment(request.nextUrl.pathname);
    if (!raw) {
      return NextResponse.json({ success: false, error: 'handling unit id required' }, { status: 400 });
    }

    let id: number | null = /^\d+$/.test(raw) ? Number(raw) : null;
    if (id == null) {
      // `H-12` handle or external tote code → resolve to the numeric id.
      const hMatch = /^H-(\d+)$/i.exec(raw);
      if (hMatch) id = Number(hMatch[1]);
      else {
        const byCode = await getHandlingUnitByCode(raw);
        if (byCode) id = byCode.id;
      }
    }
    if (id == null || !Number.isFinite(id)) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }

    const detail = await getHandlingUnitDetail(id);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Handling unit not found' }, { status: 404 });
    }
    // Mirror `receiving_line_ids` at the top level too — the testing resolver
    // reads either shape.
    return NextResponse.json({
      success: true,
      handling_unit: detail,
      receiving_line_ids: detail.receiving_line_ids,
    });
  },
  { permission: 'handling_unit.view' },
);

function extractIdSegment(pathname: string): string {
  const m = /\/api\/handling-units\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1] || '').trim() : '';
}
