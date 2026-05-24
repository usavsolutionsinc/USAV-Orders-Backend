import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import { isInventoryV2Allocation } from '@/lib/feature-flags';
import { allocateOrder } from '@/lib/inventory/allocate';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/pane-header';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory/bulk-allocate
 *
 * Operations tool for Phase 4 rollout. Lists orders that have a SKU but
 * no open order_unit_allocations row, alongside how many STOCKED
 * serial_units exist for the same SKU. A per-row server action calls
 * allocateOrder() (the same helper /api/orders/[id]/allocate uses) and
 * revalidates the page so the result lands in the same render cycle.
 *
 * Gated by INVENTORY_V2_ALLOCATION at render time — off-flag the page
 * still renders the candidate list but the action returns a banner
 * rather than mutating. Useful for previewing the allocation set before
 * flipping the flag.
 *
 * Permission gate: orders.view (matches the API).
 */

interface CandidateRow {
  order_id: number;
  order_id_text: string | null;
  sku: string;
  condition: string | null;
  quantity_str: string | null;
  available_stocked: number;
}

const PAGE_SIZE = 100;

async function loadCandidates(page: number): Promise<{ rows: CandidateRow[]; total: number }> {
  // Orders that meet ALL of:
  //   - have a non-empty SKU
  //   - have NO open (non-RELEASED) order_unit_allocations row
  //   - status is null or NOT 'shipped' (don't re-allocate shipped orders)
  // The available_stocked column reflects current STOCKED inventory for
  // the SKU at query time — purely diagnostic, not locked.
  try {
    const totalQ = await queryRaw<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM orders o
        WHERE o.sku IS NOT NULL AND BTRIM(o.sku) <> ''
          AND COALESCE(o.status, '') <> 'shipped'
          AND NOT EXISTS (
            SELECT 1 FROM order_unit_allocations oua
             WHERE oua.order_id = o.id AND oua.state <> 'RELEASED'
          )`,
    );
    const total = totalQ[0]?.n ?? 0;

    const rows = await queryRaw<CandidateRow>(
      `SELECT o.id AS order_id, o.order_id AS order_id_text,
              o.sku AS sku, o.condition,
              o.quantity AS quantity_str,
              COALESCE(stocked.n, 0)::int AS available_stocked
         FROM orders o
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS n
             FROM serial_units su
            WHERE su.current_status = 'STOCKED'::serial_status_enum
              AND su.sku = o.sku
         ) stocked ON TRUE
        WHERE o.sku IS NOT NULL AND BTRIM(o.sku) <> ''
          AND COALESCE(o.status, '') <> 'shipped'
          AND NOT EXISTS (
            SELECT 1 FROM order_unit_allocations oua
             WHERE oua.order_id = o.id AND oua.state <> 'RELEASED'
          )
        ORDER BY o.id DESC
        LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, page * PAGE_SIZE],
    );
    return { rows, total };
  } catch {
    return { rows: [], total: 0 };
  }
}

/** Server action: allocate one order. Revalidates the page after. */
async function allocateOne(formData: FormData): Promise<void> {
  'use server';
  if (!isInventoryV2Allocation()) return;
  const id = Number(formData.get('orderId'));
  if (!Number.isFinite(id) || id <= 0) return;
  try {
    await allocateOrder({ orderId: id, actorStaffId: null });
  } catch (err) {
    console.error('[bulk-allocate] allocateOne failed:', err);
  }
  revalidatePath('/admin/inventory/bulk-allocate');
}

export default async function BulkAllocatePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const page = Math.max(0, Number(params.page ?? 0) || 0);
  const flagOn = isInventoryV2Allocation();
  const { rows, total } = await loadCandidates(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader backHref="/admin/inventory" title="Bulk allocate" maxWidth="6xl" />
      <div className="mx-auto max-w-6xl space-y-6 p-8">
        <p className="text-sm text-gray-600">
          Orders with a SKU and no open allocation. Click <em>Allocate</em> to reserve STOCKED units FIFO.
        </p>

        {!flagOn ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Preview mode.</strong>{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">INVENTORY_V2_ALLOCATION</code> is OFF.
            The list below shows what <em>would</em> allocate. Clicking <em>Allocate</em> is a no-op until the flag flips.
          </div>
        ) : null}

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
            <div className="text-sm text-gray-700">
              <span className="font-semibold">{total.toLocaleString()}</span> order{total === 1 ? '' : 's'} awaiting allocation
              {total > PAGE_SIZE ? <span className="text-gray-500"> · page {page + 1} of {totalPages}</span> : null}
            </div>
            {total > PAGE_SIZE ? (
              <nav className="flex items-center gap-2 text-sm">
                {page > 0 ? (
                  <Link href={`/admin/inventory/bulk-allocate?page=${page - 1}`} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
                    ← prev
                  </Link>
                ) : null}
                {page + 1 < totalPages ? (
                  <Link href={`/admin/inventory/bulk-allocate?page=${page + 1}`} className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
                    next →
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </header>

          {rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">
              Every non-shipped order with a SKU already has an open allocation. Nothing to do.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Order id</th>
                    <th className="px-4 py-2 text-left font-medium">Ext id</th>
                    <th className="px-4 py-2 text-left font-medium">SKU</th>
                    <th className="px-4 py-2 text-left font-medium">Condition</th>
                    <th className="px-4 py-2 text-right font-medium">Qty</th>
                    <th className="px-4 py-2 text-right font-medium">Available STOCKED</th>
                    <th className="px-4 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const qty = Math.max(1, Math.floor(Number(r.quantity_str ?? '1') || 1));
                    const eligible = r.available_stocked >= qty;
                    return (
                      <tr key={r.order_id}>
                        <td className="px-4 py-2 font-mono text-xs">#{r.order_id}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.order_id_text ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link href={`/admin/inventory/sku/${encodeURIComponent(r.sku)}`} className="text-blue-600 hover:underline">
                            {r.sku}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">{r.condition ?? '—'}</td>
                        <td className="px-4 py-2 text-right text-sm">{qty}</td>
                        <td className={`px-4 py-2 text-right text-sm font-semibold ${
                          eligible ? 'text-green-700' : r.available_stocked > 0 ? 'text-amber-700' : 'text-red-700'
                        }`}>
                          {r.available_stocked}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <form action={allocateOne}>
                            <input type="hidden" name="orderId" value={r.order_id} />
                            <button
                              type="submit"
                              disabled={!eligible || !flagOn}
                              className={`rounded-md px-3 py-1 text-xs font-medium ${
                                !eligible || !flagOn
                                  ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                              title={
                                !flagOn ? 'INVENTORY_V2_ALLOCATION flag is OFF' :
                                !eligible ? `Need ${qty} stocked, only ${r.available_stocked} available` :
                                'Allocate this order'
                              }
                            >
                              {eligible ? 'Allocate' : 'Insufficient'}
                            </button>
                          </form>
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
          Allocation runs through the same code path as
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5">POST /api/orders/[id]/allocate</code>
          (<code className="rounded bg-gray-100 px-1 py-0.5">src/lib/inventory/allocate.ts</code>) — FIFO by
          serial_units.id, locked via <code>FOR UPDATE SKIP LOCKED</code>, idx_oua_open_unit is the final guard
          against double-allocation.
        </footer>
      </div>
    </div>
  );
}
