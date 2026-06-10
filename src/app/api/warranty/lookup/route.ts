import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { lookupCoverage } from '@/lib/warranty/coverage';
import { WarrantyCoverageQuery } from '@/lib/schemas/warranty';

function flagOff() {
  return NextResponse.json(
    { ok: false, error: 'WARRANTY_LOGGER flag is OFF', flag: 'WARRANTY_LOGGER' },
    { status: 503 },
  );
}

/**
 * GET /api/warranty/lookup?q=<order#|serial|sku>
 *
 * Read-only warranty-coverage check for the "on the phone with a customer" flow.
 * Resolves the identifier to a shipped order and computes the warranty clock
 * without logging a claim. Gated by WARRANTY_LOGGER. Permission: warranty.view.
 */
export const GET = withAuth(async (request, ctx) => {
  if (!isWarrantyLogger()) return flagOff();

  const parsed = WarrantyCoverageQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid query', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const coverage = await lookupCoverage(parsed.data.q, ctx.organizationId ?? null);
    return NextResponse.json({ ok: true, coverage });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'warranty coverage lookup failed';
    console.error('[GET /api/warranty/lookup] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'warranty.view' });
