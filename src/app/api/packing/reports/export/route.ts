import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { z } from 'zod';
import { parseBody } from '@/lib/schemas/parse';
import { getCurrentPSTDateKey } from '@/utils/date';
import { buildPackingReportRows, packingRowsToCsv } from '@/lib/packing/packing-report';

const PackingReportQuery = z
  .object({
    day: z.string().trim().min(1).optional(), // YYYY-MM-DD PST
    packerId: z.coerce.number().int().positive().optional(),
    format: z.enum(['csv', 'json']).optional(),
  })
  .strict();

/**
 * GET /api/packing/reports/export?day=YYYY-MM-DD&packerId=123&format=csv|json
 *
 * CSV by default. Manager-facing per-packer (or all) packing activity export,
 * including pack tier + estimated minutes.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const raw = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = parseBody(PackingReportQuery, raw);
  if (parsed instanceof NextResponse) return parsed;

  const day = parsed.day ?? getCurrentPSTDateKey();
  const packerId = parsed.packerId ?? null;
  const format = parsed.format ?? 'csv';

  try {
    const rows = await buildPackingReportRows({ day, packerId }, ctx.organizationId);
    if (format === 'json') return NextResponse.json({ ok: true, rows });

    const csv = packingRowsToCsv(rows);
    const fileName = packerId ? `packing-report-${day}-packer-${packerId}.csv` : `packing-report-${day}-all-packers.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'packing report failed';
    console.error('[GET /api/packing/reports/export] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'operations.view' });

