import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw, queryOne } from '@/lib/neon-client';
import { submitCount, approveLine, rejectLine, closeCampaign } from '@/lib/inventory/cycle-count';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory-v2/cycle-counts/[id]
 *
 * Per-campaign detail. Lists every cycle_count_lines row with:
 *   - inline count form for pending lines (server action → submitCount)
 *   - approve / reject buttons for pending_review lines (server actions)
 *   - status badge + variance summary for approved / rejected rows
 *
 * Header actions:
 *   - Close campaign (auto-approves remaining 'counted' lines)
 *
 * Filter pill row: all | pending | counted | pending_review | approved | rejected
 */

type StatusFilter = 'all' | 'pending' | 'counted' | 'pending_review' | 'approved' | 'rejected';

interface CampaignRow {
  id: number;
  name: string;
  status: string;
  variance_tol: string;
  created_at: Date;
  closed_at: Date | null;
}

interface LineRow {
  id: number;
  bin_id: number;
  bin_name: string | null;
  sku: string;
  expected_qty: number;
  counted_qty: number | null;
  variance: number | null;
  status: string;
  counted_by_name: string | null;
  counted_at: Date | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  notes: string | null;
}

interface StatusCount {
  status: string;
  count: number;
}

function isStatusFilter(v: string | undefined): v is StatusFilter {
  return v === 'all' || v === 'pending' || v === 'counted' || v === 'pending_review' || v === 'approved' || v === 'rejected';
}

async function loadCampaign(id: number): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>`
    SELECT id, name, status::text AS status,
           variance_tol::text AS variance_tol,
           created_at, closed_at
      FROM cycle_count_campaigns WHERE id = ${id} LIMIT 1`;
}

async function loadLines(id: number, filter: StatusFilter): Promise<LineRow[]> {
  const filters = filter === 'all' ? '' : `AND l.status = $2`;
  try {
    return await queryRaw<LineRow>(
      `SELECT l.id, l.bin_id, loc.name AS bin_name,
              l.sku, l.expected_qty, l.counted_qty, l.variance,
              l.status::text AS status,
              cb.name AS counted_by_name, l.counted_at,
              ab.name AS approved_by_name, l.approved_at,
              l.notes
         FROM cycle_count_lines l
         LEFT JOIN locations loc ON loc.id = l.bin_id
         LEFT JOIN staff cb ON cb.id = l.counted_by
         LEFT JOIN staff ab ON ab.id = l.approved_by
        WHERE l.campaign_id = $1 ${filters}
        ORDER BY
          CASE l.status
            WHEN 'pending_review' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'counted' THEN 2
            WHEN 'approved' THEN 3
            WHEN 'rejected' THEN 4
            ELSE 9
          END,
          loc.name ASC, l.sku ASC
        LIMIT 500`,
      filter === 'all' ? [id] : [id, filter],
    );
  } catch {
    return [];
  }
}

async function loadStatusCounts(id: number): Promise<StatusCount[]> {
  try {
    return await queryRaw<StatusCount>(
      `SELECT status::text AS status, COUNT(*)::int AS count
         FROM cycle_count_lines
        WHERE campaign_id = $1
        GROUP BY status`,
      [id],
    );
  } catch {
    return [];
  }
}

// ─── Server actions ────────────────────────────────────────────────────────

async function submitCountAction(formData: FormData): Promise<void> {
  'use server';
  const lineId = Number(formData.get('lineId'));
  const countedQty = Number(formData.get('countedQty'));
  const campaignId = Number(formData.get('campaignId'));
  if (!Number.isFinite(lineId) || lineId <= 0) return;
  if (!Number.isFinite(countedQty) || countedQty < 0) {
    redirect(`/admin/inventory-v2/cycle-counts/${campaignId}?error=invalid_qty`);
  }
  try {
    await submitCount({ lineId, countedQty: Math.floor(countedQty), countedByStaffId: null });
  } catch (err) {
    console.error('[cycle-counts.submit] failed:', err);
  }
  revalidatePath(`/admin/inventory-v2/cycle-counts/${campaignId}`);
}

async function approveAction(formData: FormData): Promise<void> {
  'use server';
  const lineId = Number(formData.get('lineId'));
  const campaignId = Number(formData.get('campaignId'));
  if (!Number.isFinite(lineId) || lineId <= 0) return;
  try {
    await approveLine({ lineId, approvedByStaffId: null });
  } catch (err) {
    console.error('[cycle-counts.approve] failed:', err);
  }
  revalidatePath(`/admin/inventory-v2/cycle-counts/${campaignId}`);
}

async function rejectAction(formData: FormData): Promise<void> {
  'use server';
  const lineId = Number(formData.get('lineId'));
  const campaignId = Number(formData.get('campaignId'));
  if (!Number.isFinite(lineId) || lineId <= 0) return;
  try {
    await rejectLine({ lineId, approvedByStaffId: null });
  } catch (err) {
    console.error('[cycle-counts.reject] failed:', err);
  }
  revalidatePath(`/admin/inventory-v2/cycle-counts/${campaignId}`);
}

async function closeAction(formData: FormData): Promise<void> {
  'use server';
  const campaignId = Number(formData.get('campaignId'));
  if (!Number.isFinite(campaignId) || campaignId <= 0) return;
  try {
    await closeCampaign({ campaignId, approvedByStaffId: null });
  } catch (err) {
    console.error('[cycle-counts.close] failed:', err);
  }
  revalidatePath(`/admin/inventory-v2/cycle-counts/${campaignId}`);
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function CycleCountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    redirect('/admin/inventory-v2/cycle-counts');
  }

  const sp = await searchParams;
  const filter: StatusFilter = isStatusFilter(sp.status) ? sp.status : 'all';
  const errorCode = sp.error ?? null;

  const [campaign, lines, statusCounts] = await Promise.all([
    loadCampaign(id),
    loadLines(id, filter),
    loadStatusCounts(id),
  ]);

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-3xl space-y-2">
          <Link href="/admin/inventory-v2/cycle-counts" className="text-sm text-blue-600 hover:underline">
            ← back to campaigns
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Campaign not found</h1>
        </div>
      </div>
    );
  }

  const isOpen = campaign.status === 'open';
  const byStatus = new Map(statusCounts.map((s) => [s.status, s.count]));
  const totalLines = statusCounts.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-1">
          <Link href="/admin/inventory-v2/cycle-counts" className="text-sm text-blue-600 hover:underline">
            ← back to campaigns
          </Link>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
              <p className="text-xs text-gray-500">
                #{campaign.id} · variance tol {campaign.variance_tol} · created {new Date(campaign.created_at).toLocaleString()}
                {campaign.closed_at ? ` · closed ${new Date(campaign.closed_at).toLocaleString()}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                isOpen ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {campaign.status}
              </span>
              {isOpen ? (
                <form action={closeAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    title="Auto-approve all 'counted' lines and close the campaign"
                  >
                    Close campaign
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </header>

        {errorCode ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorCode === 'invalid_qty' && 'Counted qty must be a non-negative integer.'}
            {errorCode !== 'invalid_qty' && 'Action failed.'}
          </div>
        ) : null}

        {/* Status filter pills */}
        <nav className="flex flex-wrap gap-2 text-xs">
          {(['all', 'pending', 'counted', 'pending_review', 'approved', 'rejected'] as const).map((s) => {
            const count = s === 'all' ? totalLines : byStatus.get(s) ?? 0;
            return (
              <Link
                key={s}
                href={`/admin/inventory-v2/cycle-counts/${id}?status=${s}`}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  filter === s
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {s} <span className={filter === s ? 'text-white/80' : 'text-gray-400'}>· {count}</span>
              </Link>
            );
          })}
        </nav>

        {/* Lines table */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-base font-medium text-gray-900">Lines</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              Pending lines accept a count submission. Pending review needs an admin decision.
            </p>
          </header>
          {lines.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No lines in this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Bin</th>
                    <th className="px-4 py-2 text-left font-medium">SKU</th>
                    <th className="px-4 py-2 text-right font-medium">Expected</th>
                    <th className="px-4 py-2 text-right font-medium">Counted</th>
                    <th className="px-4 py-2 text-right font-medium">Δ</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l) => {
                    const isPending = l.status === 'pending';
                    const isReview = l.status === 'pending_review';
                    const isCounted = l.status === 'counted';
                    return (
                      <tr key={l.id}>
                        <td className="px-4 py-2 font-mono text-xs">{l.bin_name ?? `#${l.bin_id}`}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link href={`/admin/inventory-v2/sku/${encodeURIComponent(l.sku)}`} className="text-blue-600 hover:underline">
                            {l.sku}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{l.expected_qty}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {isPending && isOpen ? (
                            <form action={submitCountAction} className="flex items-center justify-end gap-2">
                              <input type="hidden" name="campaignId" value={campaign.id} />
                              <input type="hidden" name="lineId" value={l.id} />
                              <input
                                type="number"
                                name="countedQty"
                                min="0"
                                step="1"
                                placeholder="qty"
                                className="w-20 rounded border border-gray-300 px-2 py-1 text-right font-mono text-xs"
                              />
                              <button type="submit" className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700">
                                Submit
                              </button>
                            </form>
                          ) : (
                            l.counted_qty ?? '—'
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${
                          l.variance == null || l.variance === 0
                            ? 'text-gray-400'
                            : Math.abs(l.variance) > l.expected_qty * Number(campaign.variance_tol)
                              ? 'font-semibold text-red-700'
                              : 'text-amber-700'
                        }`}>
                          {l.variance == null ? '—' : (l.variance > 0 ? '+' : '') + l.variance}
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            l.status === 'pending' ? 'bg-gray-100 text-gray-600' :
                            l.status === 'counted' ? 'bg-blue-100 text-blue-700' :
                            l.status === 'pending_review' ? 'bg-amber-100 text-amber-800' :
                            l.status === 'approved' ? 'bg-green-100 text-green-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {l.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {(isReview || isCounted) && isOpen ? (
                            <div className="flex items-center justify-end gap-1">
                              <form action={approveAction}>
                                <input type="hidden" name="campaignId" value={campaign.id} />
                                <input type="hidden" name="lineId" value={l.id} />
                                <button type="submit" className="rounded bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700">
                                  Approve
                                </button>
                              </form>
                              <form action={rejectAction}>
                                <input type="hidden" name="campaignId" value={campaign.id} />
                                <input type="hidden" name="lineId" value={l.id} />
                                <button type="submit" className="rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
                                  Reject
                                </button>
                              </form>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-500">
                              {l.approved_by_name ? `by ${l.approved_by_name}` :
                                l.counted_by_name ? `counted by ${l.counted_by_name}` : '—'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-xs text-gray-500">
          Approval writes <code>sku_stock_ledger</code> with reason{' '}
          <code>CYCLE_COUNT_ADJ</code> for the variance delta and updates{' '}
          <code>bin_contents.qty</code> + <code>last_counted</code>. Code path:{' '}
          <code>src/lib/inventory/cycle-count.ts</code>.
        </footer>
      </div>
    </div>
  );
}
