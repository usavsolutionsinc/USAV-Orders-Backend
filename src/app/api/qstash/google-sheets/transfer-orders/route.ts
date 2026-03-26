import { NextRequest, NextResponse } from 'next/server';
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs';
import { getAppBaseUrl } from '@/lib/qstash';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handleTransferOrders(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { manualSheetName?: string };
  try {
    return NextResponse.json(await runGoogleSheetsTransferOrders(body.manualSheetName));
  } catch (error: any) {
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export const POST = verifySignatureAppRouter(handleTransferOrders, {
  url: `${getAppBaseUrl()}/api/qstash/google-sheets/transfer-orders`,
});

export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'google-sheets-transfer-orders' });
}
