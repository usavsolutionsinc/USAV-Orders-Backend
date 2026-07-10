import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { buildWarrantyReportRows, toCsv, WARRANTY_REPORT_COLUMNS } from '@/lib/warranty/reports';
import { WarrantyReportQuery } from '@/lib/schemas/warranty';

/**
 * GET /api/warranty/reports/export
 *
 * Supplier-escalation export: claims rolled up with denial reason, repair
 * outcome + parts/labor cost, and RMA / repair links. CSV by default (?format=json
 * for the raw rows). Filters: status, sku, from, to, outcome. Gated by WARRANTY_LOGGER.
 */
export const GET = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) {
    return NextResponse.json(
      { ok: false, error: 'WARRANTY_LOGGER flag is OFF', flag: 'WARRANTY_LOGGER' },
      { status: 503 },
    );
  }

  const parsed = WarrantyReportQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid query', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Tenant isolation: thread the caller's org so the report query runs through
    // the GUC-wrapped tenant pool with an explicit `wc.organization_id = $6`
    // predicate (plus org-aligned reason_codes join + org-scoped repair-attempts
    // LATERAL). Without it the CSV would leak every tenant's claims.
    const rows = await buildWarrantyReportRows(
      {
        status: parsed.data.status ?? null,
        sku: parsed.data.sku ?? null,
        from: parsed.data.from ?? null,
        to: parsed.data.to ?? null,
        outcome: parsed.data.outcome ?? null,
      },
      ctx.organizationId,
    );

    if (parsed.data.format === 'json') {
      return NextResponse.json({ ok: true, rows });
    }

    const csv = toCsv(rows, WARRANTY_REPORT_COLUMNS);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="warranty-claims-report.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'warranty report failed';
    console.error('[GET /api/warranty/reports/export] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.view', feature: 'repair' });
