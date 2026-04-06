import { NextRequest, NextResponse } from 'next/server';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isQStashOrigin(request: NextRequest): boolean {
  // QStash always sends the upstash-signature header — use its presence as
  // proof the request came through the QStash pipeline. The QSTASH_TOKEN env
  // var acts as a shared secret: if it matches, the caller is authorised.
  const signature = request.headers.get('upstash-signature');
  if (signature) return true;

  // Fallback: allow calls that include the QSTASH_TOKEN as a bearer token
  // (e.g. manual curl tests or the bootstrap script).
  const authHeader = request.headers.get('authorization');
  const token = process.env.QSTASH_TOKEN;
  if (token && authHeader === `Bearer ${token}`) return true;

  return false;
}

export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { manualSheetName?: string };
  console.log('[qstash/google-sheets/transfer-orders] Starting job', {
    manualSheetName: body.manualSheetName ?? '(auto-detect)',
  });

  try {
    const result = await runGoogleSheetsTransferOrders(body.manualSheetName);
    console.log('[qstash/google-sheets/transfer-orders] Completed', {
      processedRows: result.processedRows,
      insertedOrders: result.insertedOrders,
      tabName: result.tabName,
      durationMs: result.durationMs,
    });
    return NextResponse.json(result);
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
