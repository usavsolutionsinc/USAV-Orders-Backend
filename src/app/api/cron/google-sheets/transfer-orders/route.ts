import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachOrgWithProvider } from '@/lib/cron/for-each-org';
import {
  GoogleSheetsTransferOrdersJobError,
  runGoogleSheetsTransferOrders,
  resolveTransferSourceSpreadsheetId,
  type GoogleSheetsTransferOrdersJobResult,
} from '@/lib/jobs/google-sheets-transfer-orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * GET /api/cron/google-sheets/transfer-orders  (Vercel cron, weekday schedule)
 *
 * Tenancy (Phase D — DONE): fans out per Google-Sheets-connected org via
 * forEachOrgWithProvider('google_sheets', …). Each org runs the transfer with
 * `orgId` supplied, so runGoogleSheetsTransferOrders routes every tenant-table
 * read/write through the GUC-carrying helpers (withTenantTransaction /
 * withTenantDrizzle / tenantQuery) and stamps organization_id explicitly (its
 * neon-http Drizzle client can't carry the GUC, so the stamp is required).
 *
 * Source sheet is per-org. USAV keeps its hardcoded sheet
 * (USAV_SOURCE_SPREADSHEET_ID) via includeUsavTransitional — it connects Google
 * with env service-account creds and has no google_sheets integration row, so
 * there is no per-org id to read for it; this is exactly the prior behavior.
 * Every OTHER org reads its OWN sheet id from its google_sheets integration
 * config (GoogleSheetsCredentials.defaultSpreadsheetId); an org with the provider
 * connected but NO configured sheet id is skipped — we never read another
 * tenant's sheet on its behalf.
 *
 * The cron runs 'sheets' mode only, so the Ecwid-API path (USAV-env-only creds in
 * fetchEcwidTransferRows) is not exercised here — it stays behind its own
 * /api/ecwid/transfer-orders route. Per-org failures are isolated by the fan-out.
 *
 * NOTE: Google API auth is still the shared service account (getGoogleAuth, env
 * GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY). A non-USAV org's sheet must be shared
 * with that service account for its transfer to succeed; until each org connects
 * its own Google auth, in practice only USAV has a usable source here.
 */

type OrgTransferOutcome =
  | GoogleSheetsTransferOrdersJobResult
  | { skipped: 'no_source_spreadsheet' }
  | { jobError: Record<string, unknown> };

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('google_sheets.transfer_orders', () =>
      withCronRun('google_sheets.transfer_orders', async () => {
        const perOrg = await forEachOrgWithProvider<OrgTransferOutcome>(
          'google_sheets',
          async (orgId): Promise<OrgTransferOutcome> => {
            const spreadsheetId = await resolveTransferSourceSpreadsheetId(orgId);
            if (!spreadsheetId) return { skipped: 'no_source_spreadsheet' };
            try {
              return await runGoogleSheetsTransferOrders(undefined, 'sheets', undefined, orgId, spreadsheetId);
            } catch (err) {
              // A job-level condition (no data in tab / missing headers) is NOT a
              // tenant failure — mirror the prior top-level handling that surfaced
              // it in the body without aborting the run. Anything else propagates
              // and is counted as orgs_failed by the fan-out.
              if (err instanceof GoogleSheetsTransferOrdersJobError) {
                return { jobError: err.body };
              }
              throw err;
            }
          },
          { includeUsavTransitional: true },
        );

        const totals = {
          processedRows: 0,
          insertedOrders: 0,
          updatedOrdersTracking: 0,
          updatedOrdersFields: 0,
          deletedDuplicateOrders: 0,
        };
        let orgsSkipped = 0;
        const jobErrors: Array<Record<string, unknown>> = [];
        const errors: string[] = [];

        for (const r of perOrg) {
          if (!r.ok) {
            if (errors.length < 25) {
              errors.push(`org ${r.orgId}: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
            }
            continue;
          }
          const res = r.result!;
          if ('skipped' in res) {
            orgsSkipped += 1;
            continue;
          }
          if ('jobError' in res) {
            if (jobErrors.length < 25) jobErrors.push({ orgId: r.orgId, ...res.jobError });
            continue;
          }
          totals.processedRows += res.processedRows;
          totals.insertedOrders += res.insertedOrders;
          totals.updatedOrdersTracking += res.updatedOrdersTracking;
          totals.updatedOrdersFields += res.updatedOrdersFields;
          totals.deletedDuplicateOrders += res.deletedDuplicateOrders;
        }

        return {
          ...totals,
          orgs_swept: perOrg.length,
          orgs_failed: perOrg.filter((r) => !r.ok).length,
          orgs_skipped: orgsSkipped,
          jobErrors,
          errors,
        };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: summary.orgs_failed === 0, ...summary });
  } catch (error) {
    if (error instanceof GoogleSheetsTransferOrdersJobError) {
      return NextResponse.json(error.body as Record<string, unknown>, { status: 200 });
    }
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('[cron/google-sheets/transfer-orders]', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
