import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import {
    GoogleSheetsTransferOrdersJobError,
    runGoogleSheetsTransferOrders,
    resolveTransferSourceSpreadsheetId,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest, ctx) => {
    const startedAt = Date.now();
    let ok = false;
    const body = await req.json().catch(() => ({}));
    const manualSheetName = body?.manualSheetName;
    const orgId = ctx.organizationId;
    const spreadsheetId = await resolveTransferSourceSpreadsheetId(orgId);

    if (!spreadsheetId) {
        return NextResponse.json(
            {
                success: false,
                error: 'No Google Sheets source configured for this organization. Connect Google Sheets under Settings → Integrations.',
            },
            { status: 400 },
        );
    }

    // Streaming NDJSON response — UI consumes events row-by-row. (Scheduled
    // runs go through the Vercel cron at /api/cron/google-sheets/transfer-orders.)
    const stream = createNdjsonStream();
    (async () => {
        try {
            const result = await runGoogleSheetsTransferOrders(
                manualSheetName,
                'sheets',
                stream.emit,
                orgId,
                spreadsheetId,
            );
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
                details: { manualSheet: Boolean(manualSheetName) },
            });
        }
    })();

    return new Response(stream.body, { headers: ndjsonResponseHeaders() });
}, { permission: 'orders.import' });

export const GET = withAuth(async (req: NextRequest, ctx) => {
    const startedAt = Date.now();
    if (!isAllowedAdminOrigin(req)) {
        logRouteMetric({
            route: '/api/google-sheets/transfer-orders',
            method: 'GET',
            startedAt,
            ok: false,
            details: {},
        });
        return NextResponse.json({ success: false, error: 'Origin not allowed' }, { status: 403 });
    }
    const orgId = ctx.organizationId;
    const spreadsheetId = await resolveTransferSourceSpreadsheetId(orgId);
    if (!spreadsheetId) {
        return NextResponse.json(
            { success: false, error: 'No Google Sheets source configured for this organization.' },
            { status: 400 },
        );
    }
    try {
        const result = await runGoogleSheetsTransferOrders(undefined, 'sheets', undefined, orgId, spreadsheetId);
        logRouteMetric({
            route: '/api/google-sheets/transfer-orders',
            method: 'GET',
            startedAt,
            ok: true,
            details: {},
        });
        return NextResponse.json({ success: true, ...(result as unknown as Record<string, unknown>) });
    } catch (error: any) {
        if (error instanceof GoogleSheetsTransferOrdersJobError) {
            // Honor the error's own status (404/400/…). Previously hardcoded to
            // 200, which made every job failure (missing tab, no data) look like
            // a success to crons/monitors keying on the HTTP status.
            return NextResponse.json(error.body as Record<string, unknown>, { status: error.status });
        }
        logRouteMetric({
            route: '/api/google-sheets/transfer-orders',
            method: 'GET',
            startedAt,
            ok: false,
            details: {},
        });
        return NextResponse.json({ success: false, error: error?.message || 'Internal Server Error' }, { status: 500 });
    }
}, { permission: 'orders.import' });
