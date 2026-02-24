import { NextResponse } from 'next/server';
import { syncEcwidToSquare } from '@/lib/ecwid-square/sync';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

/**
 * POST /api/ecwid-square/sync
 * Triggers one-way Ecwid -> Square catalog sync.
 *
 * Optional body:
 * {
 *   "dryRun": true,
 *   "batchSize": 199
 * }
 */
export async function POST(req: Request) {
  try {
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json(
        {
          success: false,
          error: `Origin not allowed: ${req.headers.get('origin')}`,
        },
        { status: 403 }
      );
    }

    let dryRun = false;
    let batchSize: number | undefined = undefined;
    try {
      const body = (await req.json()) as { dryRun?: boolean; batchSize?: number };
      dryRun = Boolean(body?.dryRun);
      if (typeof body?.batchSize === 'number' && Number.isFinite(body.batchSize)) {
        batchSize = body.batchSize;
      }
    } catch {
      // Ignore JSON parse failures and continue with defaults.
    }

    const result = await syncEcwidToSquare({ dryRun, batchSize });
    const status = result.success ? 200 : 500;

    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Ecwid/Square sync error:', error);

    return NextResponse.json(
      {
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
