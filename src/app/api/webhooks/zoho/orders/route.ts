import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * LEGACY — /api/webhooks/zoho/orders is retired (audit F05).
 *
 * This route used to ingest Zoho order-created webhooks scoped to the USAV
 * org. It has been replaced by the tokenized, org-resolving endpoint
 * `/api/zoho/webhooks/[token]` (see src/app/api/zoho/webhooks/README.md and
 * src/lib/zoho/webhooks/resolve-org.ts), which resolves the tenant from the
 * webhook token instead of assuming a single org.
 *
 * The file is kept (not deleted) because this URL may still be registered in
 * a Zoho console; a loud 410 with a pointer is the safe strangler. Do not
 * re-add ingestion logic here.
 */

const GONE_BODY = {
  ok: false,
  error: 'gone',
  hint:
    'This endpoint is retired. Re-register the webhook against the tokenized ' +
    'endpoint /api/zoho/webhooks/{token} (per-org token; see Zoho integration settings).',
} as const;

export async function POST() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}

/** Zoho's "Test" button probe gets the same pointer. */
export async function GET() {
  return NextResponse.json(GONE_BODY, { status: 410 });
}
