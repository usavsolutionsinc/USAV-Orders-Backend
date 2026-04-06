import { NextRequest, NextResponse } from 'next/server';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import {
    GoogleSheetsTransferOrdersJobError,
    runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { logRouteMetric } from '@/lib/route-metrics';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const startedAt = Date.now();
    let ok = false;
    let queued = false;
    const body = await req.json().catch(() => ({}));
    const manualSheetName = body?.manualSheetName;
    if (body?.enqueue === true) {
        const result = await enqueueQStashJson({
            path: '/api/qstash/google-sheets/transfer-orders',
            body: { manualSheetName },
            retries: 3,
            timeout: 300,
            label: 'google-sheets-transfer-orders',
        });
        ok = true;
        queued = true;
        return NextResponse.json({
            success: true,
            queued: true,
            messageId: getQStashResultIdentifier(result),
        });
    }
    try {
        const result = await runGoogleSheetsTransferOrders(manualSheetName);

        // Immediately resolve any open exceptions that now match newly imported orders
        let exceptionsResolved = 0;
        try {
            const syncResult = await syncOrderExceptionsToOrders();
            exceptionsResolved = syncResult.matched;
        } catch (err: any) {
            console.error('[google-sheets/transfer-orders] Exception sync failed (non-fatal):', err?.message);
        }

        ok = true;
        return NextResponse.json({ ...result, exceptionsResolved });
    } catch (error: any) {
        if (error instanceof GoogleSheetsTransferOrdersJobError) {
            return NextResponse.json(error.body, { status: error.status });
        }
        return NextResponse.json(
            { success: false, error: error?.message || 'Internal Server Error' },
            { status: 500 }
        );
    } finally {
        logRouteMetric({
            route: '/api/google-sheets/transfer-orders',
            method: 'POST',
            startedAt,
            ok,
            details: {
                queued,
                manualSheet: Boolean(manualSheetName),
            },
        });
    }
}

export async function GET(req: NextRequest) {
    const startedAt = Date.now();
    if (!isAllowedAdminOrigin(req)) {
        logRouteMetric({
            route: '/api/google-sheets/transfer-orders',
            method: 'GET',
            startedAt,
            ok: false,
            details: { queued: false },
        });
        return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
    }
    const result = await enqueueQStashJson({
        path: '/api/qstash/google-sheets/transfer-orders',
        body: {},
        retries: 3,
        timeout: 300,
        label: 'google-sheets-transfer-orders',
    });
    const response = NextResponse.json({
        success: true,
        queued: true,
        messageId: getQStashResultIdentifier(result),
    });
    logRouteMetric({
        route: '/api/google-sheets/transfer-orders',
        method: 'GET',
        startedAt,
        ok: true,
        details: { queued: true },
    });
    return response;
}
