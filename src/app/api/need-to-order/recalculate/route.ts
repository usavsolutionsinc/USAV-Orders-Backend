import { NextRequest, NextResponse } from 'next/server';
import { requireInternalToken } from '@/lib/internal-api';
import { runReplenishmentSync } from '@/lib/replenishment';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export async function POST(req: NextRequest) {
  const authError = requireInternalToken(req);
  if (authError) return authError;

  try {
    // ZOHO_ORG_TRANSITIONAL: internal-token route has no session, so the
    // service-org shim supplies the tenant. Replenishment fns now REQUIRE
    // an orgId (the unscoped fallback path was removed).
    await runReplenishmentSync(transitionalUsavOrgId());
    return NextResponse.json({ success: true, message: 'Replenishment sync completed' });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to recalculate replenishment data', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
