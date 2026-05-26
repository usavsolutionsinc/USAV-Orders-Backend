import { NextRequest, NextResponse } from 'next/server';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import {
    GoogleSheetsTransferOrdersJobError,
    runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest) => {
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

    // Streaming NDJSON response — UI consumes events row-by-row.
    const stream = createNdjsonStream();
    (async () => {
        try {
            const result = await runGoogleSheetsTransferOrders(manualSheetName, 'sheets', stream.emit);
            stream.emit({ type: 'result', result: result as unknown as Record<string, unknown> });
            ok = true;
        } catch (error: any) {
            if (error instanceof GoogleSheetsTransferOrdersJobError) {
                stream.emit({ type: 'result', result: error.body as Record<string, unknown> });
            } else {
                stream.emit({ type: 'error', error: error?.message || 'Internal Server Error' });
            }
        } finally {
            stream.finish();
            logRouteMetric({
                route: '/api/google-sheets/transfer-orders',
                method: 'POST',
                startedAt,
                ok,
                details: { queued, manualSheet: Boolean(manualSheetName) },
            });
        }
    })();

    return new Response(stream.body, { headers: ndjsonResponseHeaders() });
}, { permission: 'orders.import' });

export const GET = withAuth(async (req: NextRequest) => {
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
}, { permission: 'orders.import' });
