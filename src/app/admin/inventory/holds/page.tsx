import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import { isInventoryV2Returns } from '@/lib/feature-flags';
import { holdUnit, releaseUnit } from '@/lib/inventory/hold';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/pane-header';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory/holds
 *
 * Operations tool for Phase 7's quarantine workflow.
 *
 *   - Hold form (top): enter a serial_unit_id or normalized serial,
 *     a reason; submits to holdUnit().
 *   - Held-units table: every serial_units row where current_status =
 *     'ON_HOLD', with a Release button + optional force-status select.
 *     Submits to releaseUnit().
 *
 * Both server actions use the same code path as
 * /api/serial-units/[id]/{hold,release}. The page renders in preview
 * mode when INVENTORY_V2_RETURNS is off (table still loads, actions
 * are disabled).
 *
 * Permission gate: admin.view at render time; underlying API permission
 * is sku_stock.adjust which the action enforces implicitly by being
 * in this admin-only page.
 */

interface HeldUnitRow {
  id: number;
  serial_number: string;
  sku: string | null;
  condition_grade: string | null;
  notes: string | null;
  hold_reason: string | null;
  restore_status: string | null;
  held_at: Date | null;
  held_by_name: string | null;
}

async function loadHeldUnits(): Promise<HeldUnitRow[]> {
  try {
    return await queryRaw<HeldUnitRow>(
      `SELECT su.id, su.serial_number, su.sku,
              su.condition_grade::text AS condition_grade,
              su.notes,
              h.notes               AS hold_reason,
              h.payload->>'restore_status' AS restore_status,
              h.occurred_at         AS held_at,
              s.name                AS held_by_name
         FROM serial_units su
         LEFT JOIN LATERAL (
           SELECT ie.notes, ie.payload, ie.occurred_at, ie.actor_staff_id
             FROM inventory_events ie
            WHERE ie.serial_unit_id = su.id
              AND ie.event_type = 'HELD'
            ORDER BY ie.occurred_at DESC, ie.id DESC
            LIMIT 1
         ) h ON TRUE
         LEFT JOIN staff s ON s.id = h.actor_staff_id
        WHERE su.current_status = 'ON_HOLD'::serial_status_enum
        ORDER BY h.occurred_at DESC NULLS LAST, su.id DESC
        LIMIT 200`,
    );
  } catch {
    return [];
  }
}

// ─── Server actions ────────────────────────────────────────────────────────

async function holdAction(formData: FormData): Promise<void> {
  'use server';
  if (!isInventoryV2Returns()) {
    redirect('/admin/inventory/holds?error=flag_off');
  }
  const refRaw = String(formData.get('ref') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!refRaw || !reason) {
    redirect('/admin/inventory/holds?error=missing_input');
  }

  // ref may be either a numeric id or a serial string
  let serialUnitId = Number(refRaw);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    try {
      const lookup = await queryRaw<{ id: number }>(
        `SELECT id FROM serial_units WHERE normalized_serial = UPPER(TRIM($1)) LIMIT 1`,
        [refRaw],
      );
      serialUnitId = lookup[0]?.id ?? 0;
    } catch {
      serialUnitId = 0;
    }
  }
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    redirect('/admin/inventory/holds?error=not_found');
  }

  try {
    await holdUnit({ serialUnitId, reason, actorStaffId: null });
  } catch (err) {
    console.error('[holds.hold] failed:', err);
  }
  revalidatePath('/admin/inventory/holds');
}

async function releaseAction(formData: FormData): Promise<void> {
  'use server';
  if (!isInventoryV2Returns()) {
    redirect('/admin/inventory/holds?error=flag_off');
  }
  const id = Number(formData.get('serialUnitId'));
  const forceStatus = String(formData.get('forceStatus') ?? '').trim() || null;
  const reason = String(formData.get('reason') ?? '').trim() || null;
  if (!Number.isFinite(id) || id <= 0) return;

  try {
    await releaseUnit({
      serialUnitId: id,
      reason,
      forceStatus,
      actorStaffId: null,
    });
  } catch (err) {
    console.error('[holds.release] failed:', err);
  }
  revalidatePath('/admin/inventory/holds');
}

const RESTORE_OPTIONS = [
  '', // = auto (use payload.restore_status)
  'STOCKED', 'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST',
  'GRADED', 'ALLOCATED', 'PICKED', 'PACKED', 'LABELED', 'STAGED',
] as const;

export default async function HoldsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission('admin.view', { enforce: true });

  const params = await searchParams;
  const errorCode = params.error ?? null;
  const flagOn = isInventoryV2Returns();
  const held = await loadHeldUnits();

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader backHref="/admin/inventory" title="Holds" maxWidth="6xl" />
      <div className="mx-auto max-w-6xl space-y-6 p-8">
        <p className="text-sm text-gray-600">
          Quarantine units mid-flow. Held units keep their previous lifecycle state in the HELD event payload so a release rolls back automatically.
        </p>

        {!flagOn ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Preview mode.</strong>{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">INVENTORY_V2_RETURNS</code> is OFF.
            The table renders but hold/release actions are disabled.
          </div>
        ) : null}

        {errorCode ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {errorCode === 'flag_off' && 'INVENTORY_V2_RETURNS flag is off.'}
            {errorCode === 'missing_input' && 'Both unit ref and reason are required.'}
            {errorCode === 'not_found' && 'No serial_units row matched that ref.'}
            {!['flag_off', 'missing_input', 'not_found'].includes(errorCode) && 'Action failed.'}
          </div>
        ) : null}

        {/* Hold form */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-3">
            <h2 className="text-base font-medium text-gray-900">Place a unit on hold</h2>
          </header>
          <form action={holdAction} className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-[1fr_2fr_auto]">
            <div>
              <label htmlFor="ref" className="block text-xs font-medium text-gray-600">Unit id or serial</label>
              <input
                id="ref"
                name="ref"
                placeholder="42 or IPH13-2026-000142"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="reason" className="block text-xs font-medium text-gray-600">Reason</label>
              <input
                id="reason"
                name="reason"
                placeholder="e.g. damaged in handling, customer dispute"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={!flagOn}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  flagOn ? 'bg-red-600 text-white hover:bg-red-700' : 'cursor-not-allowed bg-gray-100 text-gray-400'
                }`}
              >
                Place on hold
              </button>
            </div>
          </form>
        </section>

        {/* Held units */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3">
            <h2 className="text-lg font-medium text-gray-900">Units on hold</h2>
            <span className="text-xs text-gray-500">{held.length} held</span>
          </header>
          {held.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">No units currently on hold.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Unit</th>
                    <th className="px-4 py-2 text-left font-medium">SKU</th>
                    <th className="px-4 py-2 text-left font-medium">Restore to</th>
                    <th className="px-4 py-2 text-left font-medium">Reason</th>
                    <th className="px-4 py-2 text-left font-medium">Held at</th>
                    <th className="px-4 py-2 text-left font-medium">By</th>
                    <th className="px-4 py-2 text-right font-medium">Release</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {held.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-2 font-mono text-xs">
                        <Link href={`/admin/inventory/units/${h.id}`} className="text-blue-600 hover:underline">
                          #{h.id} · {h.serial_number}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{h.sku ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">{h.restore_status ?? 'STOCKED'}</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{h.hold_reason ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{h.held_at ? new Date(h.held_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{h.held_by_name ?? 'system'}</td>
                      <td className="px-4 py-2 text-right">
                        <form action={releaseAction} className="flex items-center justify-end gap-2">
                          <input type="hidden" name="serialUnitId" value={h.id} />
                          <select
                            name="forceStatus"
                            defaultValue=""
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            title="Override the auto-recovered restore status (blank = auto)"
                          >
                            {RESTORE_OPTIONS.map((s) => (
                              <option key={s || 'auto'} value={s}>{s || 'auto'}</option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={!flagOn}
                            className={`rounded-md px-3 py-1 text-xs font-medium ${
                              flagOn ? 'bg-green-600 text-white hover:bg-green-700' : 'cursor-not-allowed bg-gray-100 text-gray-400'
                            }`}
                          >
                            Release
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="text-xs text-gray-500">
          Hold + release run through{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5">src/lib/inventory/hold.ts</code>
          {' '}— same code path as <code className="rounded bg-gray-100 px-1 py-0.5">POST /api/serial-units/[id]/&#123;hold,release&#125;</code>.
        </footer>
      </div>
    </div>
  );
}
