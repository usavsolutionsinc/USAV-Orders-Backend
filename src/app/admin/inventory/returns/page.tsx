import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import { processReturnsIntake } from '@/lib/inventory/returns';
import { parseScannedUrl } from '@/lib/scan-resolver';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/pane-header';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory/returns
 *
 * Operations tool for Phase 7's returns dock.
 *
 * Top form: paste one or more serials (newline OR comma separated) +
 * optional tracking number + reason. Server action splits the textarea,
 * resolves GS1 URLs via parseScannedUrl, and calls processReturnsIntake.
 *
 * Recent returns table: last 50 inventory_events of type='RETURNED',
 * with each unit linked through to its timeline.
 */

interface RecentReturnRow {
  id: number;
  occurred_at: Date;
  serial_unit_id: number | null;
  sku: string | null;
  prev_status: string | null;
  scan_token: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
  actor_name: string | null;
}

async function loadRecentReturns(): Promise<RecentReturnRow[]> {
  try {
    return await queryRaw<RecentReturnRow>(
      `SELECT ie.id, ie.occurred_at,
              ie.serial_unit_id, ie.sku,
              ie.prev_status, ie.scan_token, ie.notes, ie.payload,
              s.name AS actor_name
         FROM inventory_events ie
         LEFT JOIN staff s ON s.id = ie.actor_staff_id
        WHERE ie.event_type = 'RETURNED'
        ORDER BY ie.occurred_at DESC, ie.id DESC
        LIMIT 50`,
    );
  } catch {
    return [];
  }
}

async function intakeAction(formData: FormData): Promise<void> {
  'use server';
  const serialsText = String(formData.get('serials') ?? '').trim();
  const tracking = String(formData.get('tracking') ?? '').trim() || null;
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!serialsText) {
    redirect('/admin/inventory/returns?error=missing_serials');
  }

  // Accept comma or newline separation. Drop empties.
  const rawSerials = serialsText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Resolve GS1 Digital Link URLs, plus split id-shaped entries from
  // serial-shaped entries.
  const serialUnitIds: number[] = [];
  const normalizedSerials: string[] = [];
  for (const raw of rawSerials) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && String(n) === raw) {
      serialUnitIds.push(n);
      continue;
    }
    const url = parseScannedUrl(raw);
    normalizedSerials.push(
      url && url.type === 'unit' ? url.unitSerial.toUpperCase() : raw.toUpperCase(),
    );
  }

  try {
    const result = await processReturnsIntake({
      serials: normalizedSerials,
      serialUnitIds,
      trackingNumber: tracking,
      reason,
      actorStaffId: null,
    });
    if (!result.ok) {
      const missing = [
        ...(result.missingSerials ?? []),
        ...(result.missingIds?.map(String) ?? []),
      ];
      const detail = missing.length > 0 ? `&missing=${encodeURIComponent(missing.join(','))}` : '';
      redirect(`/admin/inventory/returns?error=${result.status === 404 ? 'not_found' : 'failed'}${detail}`);
    }
  } catch (err) {
    console.error('[returns.intake] failed:', err);
    redirect('/admin/inventory/returns?error=failed');
  }

  revalidatePath('/admin/inventory/returns');
  redirect('/admin/inventory/returns?ok=1');
}

export default async function ReturnsIntakeAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; missing?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const okFlash = params.ok === '1';
  const errorCode = params.error ?? null;
  const missing = params.missing ?? null;
  const recent = await loadRecentReturns();

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader backHref="/admin/inventory" title="Returns intake" maxWidth="6xl" />
      <div className="mx-auto max-w-6xl space-y-6 p-8">
        <p className="text-sm text-gray-600">
          Receive units back into the warehouse. Each scanned serial gets a
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">RETURNED</code>
          event, transitions to that state, and produces a
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">RETURN_CUSTOMER</code>
          ledger row.
        </p>

        {okFlash ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            Return intake recorded. See <strong>Recent returns</strong> below.
          </div>
        ) : null}

        {errorCode ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorCode === 'missing_serials' && 'Paste at least one serial or unit id.'}
            {errorCode === 'not_found' && (
              <>
                Some serials/ids didn&apos;t match any <code className="rounded bg-red-100 px-1 py-0.5 text-xs">serial_units</code> row.
                {missing ? <> Missing: <code className="rounded bg-red-100 px-1 py-0.5 text-xs">{missing}</code></> : null}
              </>
            )}
            {errorCode === 'failed' && 'Intake failed. Check server logs.'}
            {!['missing_serials', 'not_found', 'failed'].includes(errorCode) && 'Action failed.'}
          </div>
        ) : null}

        {/* Intake form */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-base font-medium text-gray-900">Record a return</h2>
          </header>
          <form action={intakeAction} className="space-y-3 px-6 py-4">
            <div>
              <label htmlFor="serials" className="block text-xs font-medium text-gray-600">
                Serials / unit ids (one per line, or comma-separated)
              </label>
              <textarea
                id="serials"
                name="serials"
                rows={4}
                placeholder={'IPH13-128-BLU-2026-000142\n12345\nhttps://app.example/01/02000000001236/21/IPH13-128-BLU-2026-000142'}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
              />
              <p className="mt-1 text-caption text-gray-500">
                Numeric values are treated as <code>serial_units.id</code>. Everything else as a serial number
                (GS1 Digital Link URLs are auto-extracted).
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="tracking" className="block text-xs font-medium text-gray-600">
                  Return tracking number (optional)
                </label>
                <input
                  id="tracking"
                  name="tracking"
                  placeholder="1Z..."
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs"
                />
              </div>
              <div>
                <label htmlFor="reason" className="block text-xs font-medium text-gray-600">
                  Reason (optional)
                </label>
                <input
                  id="reason"
                  name="reason"
                  placeholder="customer return"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="rounded-md bg-orange-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-700"
              >
                Record intake
              </button>
              <p className="text-caption text-gray-500">
                After intake, run the triage flow to re-enter refurb if applicable.
              </p>
            </div>
          </form>
        </section>

        {/* Recent returns */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
            <h2 className="text-lg font-medium text-gray-900">Recent returns</h2>
            <span className="text-xs text-gray-500">last 50</span>
          </header>
          {recent.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No returns recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">When</th>
                    <th className="px-4 py-2 text-left font-medium">Unit</th>
                    <th className="px-4 py-2 text-left font-medium">SKU</th>
                    <th className="px-4 py-2 text-left font-medium">Prev</th>
                    <th className="px-4 py-2 text-left font-medium">Tracking</th>
                    <th className="px-4 py-2 text-left font-medium">Reason</th>
                    <th className="px-4 py-2 text-left font-medium">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recent.map((r) => {
                    const orderId = (r.payload as { order_id?: number | null })?.order_id ?? null;
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {r.serial_unit_id ? (
                            <Link href={`/admin/inventory/units/${r.serial_unit_id}`} className="text-blue-600 hover:underline">
                              #{r.serial_unit_id}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {r.sku ? (
                            <Link href={`/admin/inventory/sku/${encodeURIComponent(r.sku)}`} className="text-blue-600 hover:underline">
                              {r.sku}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.prev_status ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-caption text-gray-600">{r.scan_token ?? '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-700">
                          {r.notes ?? '—'}
                          {orderId ? <span className="ml-1 text-gray-400">· ord#{orderId}</span> : null}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.actor_name ?? 'system'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-xs text-gray-500">
          Intake runs through{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5">src/lib/inventory/returns.ts</code>
          {' '}— same code path as <code className="rounded bg-gray-100 px-1 py-0.5">POST /api/returns/intake</code>.
        </footer>
      </div>
    </div>
  );
}
