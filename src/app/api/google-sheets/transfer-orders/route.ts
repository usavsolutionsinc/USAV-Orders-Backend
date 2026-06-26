import { NextRequest, NextResponse } from 'next/server';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import {
    GoogleSheetsTransferOrdersJobError,
    runGoogleSheetsTransferOrders,
} from '@/lib/jobs/google-sheets-transfer-orders';
import { logRouteMetric } from '@/lib/route-metrics';
import { withAuth } from '@/lib/auth/withAuth';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';
import { transitionalUsavOrgId } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (req: NextRequest) => {
    const startedAt = Date.now();
    let ok = false;
    const body = await req.json().catch(() => ({}));
    const manualSheetName = body?.manualSheetName;

    // TRANSITIONAL: this transfer endpoint also backs a Vercel cron that has no
    // session, so there is no ctx.organizationId. Single-tenant (USAV) today;
    // resolve the service org and pass it into the shared sync job so all its
    // tenant-table reads/writes run GUC-scoped (app.current_org) + stamp org.
    // TODO(multi-tenant): resolve org from the per-connection / sheet→org
    // mapping instead of the USAV service org.
    // (no-restricted-syntax tenancy guard turned off for this file via the
    // burn-down allowlist in eslint.config.mjs — delete that entry when refactored.)
    const orgId = transitionalUsavOrgId();

    // Streaming NDJSON response — UI consumes events row-by-row. (Scheduled
    // runs go through the Vercel cron at /api/cron/google-sheets/transfer-orders.)
    const stream = createNdjsonStream();
    (async () => {
        try {
            const result = await runGoogleSheetsTransferOrders(manualSheetName, 'sheets', stream.emit, orgId);
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

export const GET = withAuth(async (req: NextRequest) => {
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
    // TRANSITIONAL: session-less cron-style trigger (origin-gated). Single-tenant
    // (USAV) today; resolve the service org and pass it into the shared sync job
    // so its tenant-table reads/writes run GUC-scoped (app.current_org) + stamp org.
    // TODO(multi-tenant): resolve org from the per-connection / sheet→org mapping
    // instead of the USAV service org.
    // (no-restricted-syntax tenancy guard turned off for this file via the
    // burn-down allowlist in eslint.config.mjs — delete that entry when refactored.)
    const orgId = transitionalUsavOrgId();
    try {
        // progress=undefined → job falls back to its internal noop; orgId is the 4th arg.
        const result = await runGoogleSheetsTransferOrders(undefined, 'sheets', undefined, orgId);
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
