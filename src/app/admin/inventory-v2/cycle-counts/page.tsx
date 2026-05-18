import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import { createCampaign } from '@/lib/inventory/cycle-count';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory-v2/cycle-counts
 *
 * Campaign list + creation. Each row links to the detail page where
 * counts get submitted and pending_review lines get approved/rejected.
 *
 * The create form is a server action that calls createCampaign() from
 * src/lib/inventory/cycle-count.ts. On success it redirects to the new
 * campaign's detail page.
 */

interface CampaignRow {
  id: number;
  name: string;
  status: string;
  variance_tol: string;
  created_at: Date;
  closed_at: Date | null;
  created_by: number | null;
  created_by_name: string | null;
  total_lines: number;
  counted_lines: number;
  pending_review_lines: number;
  approved_lines: number;
}

async function loadCampaigns(): Promise<CampaignRow[]> {
  try {
    return await queryRaw<CampaignRow>(
      `SELECT c.id, c.name, c.status::text AS status,
              c.variance_tol::text AS variance_tol,
              c.created_at, c.closed_at, c.created_by, s.name AS created_by_name,
              COALESCE(stats.total_lines, 0)::int AS total_lines,
              COALESCE(stats.counted_lines, 0)::int AS counted_lines,
              COALESCE(stats.pending_review_lines, 0)::int AS pending_review_lines,
              COALESCE(stats.approved_lines, 0)::int AS approved_lines
         FROM cycle_count_campaigns c
         LEFT JOIN staff s ON s.id = c.created_by
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*)::int AS total_lines,
             COUNT(*) FILTER (WHERE l.status = 'counted')::int AS counted_lines,
             COUNT(*) FILTER (WHERE l.status = 'pending_review')::int AS pending_review_lines,
             COUNT(*) FILTER (WHERE l.status = 'approved')::int AS approved_lines
           FROM cycle_count_lines l WHERE l.campaign_id = c.id
         ) stats ON TRUE
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 50`,
    );
  } catch {
    return [];
  }
}

async function createCampaignAction(formData: FormData): Promise<void> {
  'use server';
  const name = String(formData.get('name') ?? '').trim();
  const tolRaw = Number(formData.get('variance_tol'));
  const tol = Number.isFinite(tolRaw) && tolRaw >= 0 && tolRaw <= 1 ? tolRaw : 0.05;
  if (!name) {
    redirect('/admin/inventory-v2/cycle-counts?error=missing_name');
  }
  try {
    const { campaignId } = await createCampaign({
      name,
      varianceTol: tol,
      createdByStaffId: null,
    });
    revalidatePath('/admin/inventory-v2/cycle-counts');
    redirect(`/admin/inventory-v2/cycle-counts/${campaignId}`);
  } catch (err) {
    console.error('[cycle-counts.create] failed:', err);
    redirect('/admin/inventory-v2/cycle-counts?error=failed');
  }
}

export default async function CycleCountsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const errorCode = params.error ?? null;
  const campaigns = await loadCampaigns();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <Link href="/admin/inventory-v2" className="text-sm text-blue-600 hover:underline">
            ← back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Cycle counts</h1>
          <p className="text-sm text-gray-600">
            Campaigns snapshot <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">bin_contents</code>{' '}
            and route counts through the variance-tolerance gate. Within tolerance auto-approves
            on close; outside tolerance lands in admin review.
          </p>
        </header>

        {errorCode ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorCode === 'missing_name' && 'Campaign name is required.'}
            {errorCode === 'failed' && 'Failed to create campaign — check server logs.'}
            {!['missing_name', 'failed'].includes(errorCode) && 'Action failed.'}
          </div>
        ) : null}

        {/* Create form */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-base font-medium text-gray-900">Start a new campaign</h2>
          </header>
          <form action={createCampaignAction} className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-[2fr_auto_auto]">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-gray-600">Name</label>
              <input
                id="name"
                name="name"
                placeholder="e.g. May 2026 month-end"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="variance_tol" className="block text-xs font-medium text-gray-600">Variance tol (0–1)</label>
              <input
                id="variance_tol"
                name="variance_tol"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue="0.05"
                className="mt-1 block w-28 rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Snapshot + create
              </button>
            </div>
          </form>
          <p className="border-t border-gray-100 bg-gray-50 px-6 py-3 text-[11px] text-gray-600">
            Snapshots every <code>bin_contents</code> row with <code>qty &gt; 0</code> or
            never-counted. Default tolerance 0.05 (5%) — counts within that auto-approve on close;
            beyond it routes to <em>pending review</em>.
          </p>
        </section>

        {/* Campaign list */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
            <h2 className="text-lg font-medium text-gray-900">Campaigns</h2>
            <span className="text-xs text-gray-500">last 50</span>
          </header>
          {campaigns.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No campaigns yet. Use the form above to start one.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Campaign</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Lines</th>
                  <th className="px-4 py-2 text-right font-medium">Counted</th>
                  <th className="px-4 py-2 text-right font-medium">Review</th>
                  <th className="px-4 py-2 text-right font-medium">Approved</th>
                  <th className="px-4 py-2 text-left font-medium">Created</th>
                  <th className="px-4 py-2 text-left font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-sm">
                      <Link href={`/admin/inventory-v2/cycle-counts/${c.id}`} className="font-semibold text-blue-600 hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-[11px] text-gray-500">tol {c.variance_tol}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        c.status === 'open' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.total_lines}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.counted_lines}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${c.pending_review_lines > 0 ? 'font-semibold text-amber-700' : ''}`}>
                      {c.pending_review_lines}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-700">{c.approved_lines}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{c.created_by_name ?? 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
