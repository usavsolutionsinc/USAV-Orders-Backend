import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { manualSheetName?: string };
  console.log('[qstash/google-sheets/transfer-orders] Starting job', {
    manualSheetName: body.manualSheetName ?? '(auto-detect)',
  });

  try {
    const result = await runGoogleSheetsTransferOrders(body.manualSheetName, 'all');

    // Immediately resolve any open exceptions that now match newly imported orders
    let exceptionsResolved = 0;
    try {
      const syncResult = await syncOrderExceptionsToOrders();
      exceptionsResolved = syncResult.matched;
      if (syncResult.matched > 0) {
        console.log('[qstash/google-sheets/transfer-orders] Resolved exceptions', {
          scanned: syncResult.scanned,
          matched: syncResult.matched,
        });
      }
    } catch (err: any) {
      console.error('[qstash/google-sheets/transfer-orders] Exception sync failed (non-fatal):', err?.message);
    }

    console.log('[qstash/google-sheets/transfer-orders] Completed', {
      processedRows: result.processedRows,
      insertedOrders: result.insertedOrders,
      tabName: result.tabName,
      durationMs: result.durationMs,
      exceptionsResolved,
    });
    return NextResponse.json({ ...result, exceptionsResolved });
  } catch (error: any) {
    console.error('[qstash/google-sheets/transfer-orders] Job failed:', error?.message, error?.stack);
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'google-sheets-transfer-orders' });
}
