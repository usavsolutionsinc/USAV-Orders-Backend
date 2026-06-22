import { NextResponse, type NextRequest } from 'next/server';
import pool from '@/lib/db';
import { isWarrantyLogger } from '@/lib/feature-flags';
import { readIdempotencyKey, withIdempotentResponse } from '@/lib/api-idempotency';
import type { OrgId } from '@/lib/tenancy/constants';

/** Shared 503 when the feature flag is off. */
export function warrantyFlagOff(): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'WARRANTY_LOGGER flag is OFF', flag: 'WARRANTY_LOGGER' },
    { status: 503 },
  );
}

export function warrantyFlagEnabled(): boolean {
  return isWarrantyLogger();
}

/**
 * Read the numeric claim id from the path. `fromEnd` = how many segments back
 * the id sits (1 for `/claims/[id]`, 2 for `/claims/[id]/submit`).
 */
export function claimIdFromPath(request: NextRequest, fromEnd = 1): number | null {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const raw = segments[segments.length - fromEnd];
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Run a mutation with response-level idempotency (replays the prior response for
 * a repeated `Idempotency-Key`) and serialize the {status, body} to JSON.
 */
export async function idempotentJson(args: {
  request: NextRequest;
  orgId: OrgId;
  staffId: number | null;
  route: string;
  bodyKey?: string | null;
  produce: () => Promise<{ status: number; body: Record<string, unknown> }>;
}): Promise<NextResponse> {
  const idempotencyKey = readIdempotencyKey(args.request, args.bodyKey ?? null);
  const out = await withIdempotentResponse(
    pool,
    { orgId: args.orgId, idempotencyKey, route: args.route, staffId: args.staffId },
    args.produce,
  );
  return NextResponse.json(out.body, { status: out.status });
}
