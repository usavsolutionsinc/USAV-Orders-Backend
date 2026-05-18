import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw, queryOne } from '@/lib/neon-client';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory-v2/units/[ref] — Per-unit timeline.
 *
 * `ref` is permissive: either a numeric serial_units.id or a serial number
 * (case-insensitive, whitespace-trimmed). Resolves to a unit, then renders:
 *   - Current state (status, condition, location, FK origins)
 *   - inventory_events timeline (every row, oldest first, with payload)
 *   - serial_unit_condition_history (grade changes only)
 *   - order_unit_allocations (every allocation, including RELEASED history)
 *   - tech_serial_numbers links (audit cross-ref)
 *
 * Each query is independent — one missing table doesn't blank the page.
 */

interface UnitRow {
  id: number;
  serial_number: string;
  normalized_serial: string;
  sku: string | null;
  sku_catalog_id: number | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_source: string | null;
  origin_receiving_line_id: number | null;
  origin_tsn_id: number | null;
  received_at: Date | null;
  received_by: number | null;
  shipping_tracking_number: string | null;
  shipment_id: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  id: number;
  occurred_at: Date;
  event_type: string;
  station: string | null;
  prev_status: string | null;
  next_status: string | null;
  bin_id: number | null;
  bin_name: string | null;
  stock_ledger_id: number | null;
  actor_staff_id: number | null;
  actor_name: string | null;
  scan_token: string | null;
  client_event_id: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
}

interface ConditionRow {
  id: number;
  assessed_at: Date;
  assessed_by_staff_id: number | null;
  assessed_by_name: string | null;
  prev_grade: string | null;
  new_grade: string;
  cosmetic_notes: string | null;
  functional_notes: string | null;
  inventory_event_id: number | null;
}

interface AllocationRow {
  id: number;
  order_id: number;
  allocated_at: Date;
  state: string;
  released_at: Date | null;
  released_reason: string | null;
  allocated_by_name: string | null;
}

interface TsnRow {
  id: number;
  station_source: string | null;
  shipment_id: number | null;
  serial_type: string;
  fnsku: string | null;
  tested_by_name: string | null;
  created_at: Date;
}

async function resolveUnit(ref: string): Promise<UnitRow | null> {
  const numeric = Number(ref);
  if (Number.isFinite(numeric) && numeric > 0) {
    return queryOne<UnitRow>`
      SELECT id, serial_number, normalized_serial, sku, sku_catalog_id,
             current_status::text AS current_status,
             current_location, condition_grade::text AS condition_grade,
             origin_source, origin_receiving_line_id, origin_tsn_id,
             received_at, received_by,
             shipping_tracking_number, shipment_id, notes,
             created_at, updated_at
        FROM serial_units WHERE id = ${Math.floor(numeric)} LIMIT 1`;
  }
  return queryOne<UnitRow>`
    SELECT id, serial_number, normalized_serial, sku, sku_catalog_id,
           current_status::text AS current_status,
           current_location, condition_grade::text AS condition_grade,
           origin_source, origin_receiving_line_id, origin_tsn_id,
           received_at, received_by,
           shipping_tracking_number, shipment_id, notes,
           created_at, updated_at
      FROM serial_units WHERE normalized_serial = UPPER(TRIM(${ref})) LIMIT 1`;
}

async function loadEvents(unitId: number): Promise<EventRow[]> {
  try {
    return await queryRaw<EventRow>(
      `SELECT ie.id, ie.occurred_at, ie.event_type, ie.station,
              ie.prev_status, ie.next_status,
              ie.bin_id, l.name AS bin_name,
              ie.stock_ledger_id,
              ie.actor_staff_id, s.name AS actor_name,
              ie.scan_token, ie.client_event_id,
              ie.notes, ie.payload
         FROM inventory_events ie
         LEFT JOIN staff s ON s.id = ie.actor_staff_id
         LEFT JOIN locations l ON l.id = ie.bin_id
        WHERE ie.serial_unit_id = $1
        ORDER BY ie.occurred_at ASC, ie.id ASC`,
      [unitId],
    );
  } catch {
    return [];
  }
}

async function loadConditionHistory(unitId: number): Promise<ConditionRow[]> {
  try {
    return await queryRaw<ConditionRow>(
      `SELECT h.id, h.assessed_at,
              h.assessed_by_staff_id, s.name AS assessed_by_name,
              h.prev_grade::text AS prev_grade,
              h.new_grade::text AS new_grade,
              h.cosmetic_notes, h.functional_notes,
              h.inventory_event_id
         FROM serial_unit_condition_history h
         LEFT JOIN staff s ON s.id = h.assessed_by_staff_id
        WHERE h.serial_unit_id = $1
        ORDER BY h.assessed_at ASC, h.id ASC`,
      [unitId],
    );
  } catch {
    return [];
  }
}

async function loadAllocations(unitId: number): Promise<AllocationRow[]> {
  try {
    return await queryRaw<AllocationRow>(
      `SELECT a.id, a.order_id, a.allocated_at,
              a.state::text AS state,
              a.released_at, a.released_reason,
              s.name AS allocated_by_name
         FROM order_unit_allocations a
         LEFT JOIN staff s ON s.id = a.allocated_by_staff_id
        WHERE a.serial_unit_id = $1
        ORDER BY a.allocated_at DESC, a.id DESC`,
      [unitId],
    );
  } catch {
    return [];
  }
}

async function loadTsnLinks(unitId: number): Promise<TsnRow[]> {
  try {
    return await queryRaw<TsnRow>(
      `SELECT tsn.id, tsn.station_source, tsn.shipment_id,
              tsn.serial_type, tsn.fnsku,
              s.name AS tested_by_name, tsn.created_at
         FROM tech_serial_numbers tsn
         LEFT JOIN staff s ON s.id = tsn.tested_by
        WHERE tsn.serial_unit_id = $1
        ORDER BY tsn.created_at ASC, tsn.id ASC`,
      [unitId],
    );
  } catch {
    return [];
  }
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>;
  const palette: Record<string, string> = {
    UNKNOWN: 'bg-gray-100 text-gray-600',
    RECEIVED: 'bg-blue-100 text-blue-700',
    TRIAGED: 'bg-blue-100 text-blue-700',
    IN_TEST: 'bg-indigo-100 text-indigo-700',
    IN_REPAIR: 'bg-amber-100 text-amber-700',
    REPAIR_DONE: 'bg-amber-100 text-amber-700',
    GRADED: 'bg-emerald-100 text-emerald-700',
    TESTED: 'bg-emerald-100 text-emerald-700',
    STOCKED: 'bg-green-100 text-green-700',
    ALLOCATED: 'bg-purple-100 text-purple-700',
    PICKED: 'bg-purple-100 text-purple-700',
    PACKED: 'bg-purple-100 text-purple-700',
    LABELED: 'bg-purple-100 text-purple-700',
    STAGED: 'bg-purple-100 text-purple-700',
    SHIPPED: 'bg-gray-200 text-gray-700',
    RETURNED: 'bg-orange-100 text-orange-700',
    RMA: 'bg-orange-100 text-orange-700',
    ON_HOLD: 'bg-red-100 text-red-700',
    SCRAPPED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${palette[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default async function UnitTimelinePage({ params }: { params: Promise<{ ref: string }> }) {
  await requirePermission('admin.view', { enforce: true });

  const { ref } = await params;
  const cleaned = decodeURIComponent(ref || '').trim();
  const unit = cleaned ? await resolveUnit(cleaned) : null;

  if (!unit) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-3xl space-y-4">
          <Link href="/admin/inventory-v2" className="text-sm text-blue-600 hover:underline">
            ← back to inventory v2 dashboard
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">Unit not found</h1>
          <p className="text-sm text-gray-600">
            No <code className="rounded bg-gray-100 px-1 py-0.5">serial_units</code> row matches{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{cleaned || '(empty)'}</code>.
            Try the numeric id or the full serial number.
          </p>
        </div>
      </div>
    );
  }

  const [events, conditions, allocations, tsnLinks] = await Promise.all([
    loadEvents(unit.id),
    loadConditionHistory(unit.id),
    loadAllocations(unit.id),
    loadTsnLinks(unit.id),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <Link href="/admin/inventory-v2" className="text-sm text-blue-600 hover:underline">
            ← back to dashboard
          </Link>
          <div className="flex items-baseline gap-4">
            <h1 className="font-mono text-2xl font-semibold text-gray-900">{unit.serial_number}</h1>
            <StatusBadge status={unit.current_status} />
            {unit.condition_grade ? (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {unit.condition_grade}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500">
            serial_units.id = <code>{unit.id}</code> · normalized = <code>{unit.normalized_serial}</code>
          </p>
        </header>

        {/* Unit metadata */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-medium text-gray-900">Current state</h2>
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-4 text-sm md:grid-cols-3">
            <Field label="SKU">{unit.sku ?? '—'}</Field>
            <Field label="Location">{unit.current_location ?? '—'}</Field>
            <Field label="Origin">{unit.origin_source ?? '—'}</Field>
            <Field label="Received at">{unit.received_at ? new Date(unit.received_at).toLocaleString() : '—'}</Field>
            <Field label="Receiving line">{unit.origin_receiving_line_id ?? '—'}</Field>
            <Field label="Origin TSN">{unit.origin_tsn_id ?? '—'}</Field>
            <Field label="Shipment id">{unit.shipment_id ?? '—'}</Field>
            <Field label="Tracking">{unit.shipping_tracking_number ?? '—'}</Field>
            <Field label="Updated at">{new Date(unit.updated_at).toLocaleString()}</Field>
          </dl>
          {unit.notes ? (
            <div className="border-t border-gray-100 px-6 py-3 text-sm text-gray-700">
              <span className="text-xs uppercase tracking-wide text-gray-500">Notes</span>
              <p className="mt-1 whitespace-pre-wrap">{unit.notes}</p>
            </div>
          ) : null}
        </section>

        {/* Timeline */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-medium text-gray-900">inventory_events timeline</h2>
            <span className="text-xs text-gray-500">{events.length} events</span>
          </header>
          {events.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-600">
              No events recorded yet. Events land when a flagged path (Phase 2+) writes for this unit.
            </p>
          ) : (
            <ol className="divide-y divide-gray-100">
              {events.map((e) => (
                <li key={e.id} className="px-6 py-3">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                      {e.event_type}
                    </code>
                    <span className="text-xs text-gray-500">
                      {new Date(e.occurred_at).toLocaleString()}
                    </span>
                    {e.station ? (
                      <span className="text-xs text-gray-600">{e.station}</span>
                    ) : null}
                    {e.prev_status || e.next_status ? (
                      <span className="text-xs">
                        <StatusBadge status={e.prev_status} /> → <StatusBadge status={e.next_status} />
                      </span>
                    ) : null}
                    {e.bin_name ? (
                      <span className="text-xs text-gray-600">bin {e.bin_name}</span>
                    ) : null}
                    <span className="ml-auto text-xs text-gray-500">
                      {e.actor_name ?? (e.actor_staff_id ? `#${e.actor_staff_id}` : 'system')}
                    </span>
                  </div>
                  {e.notes ? <p className="mt-1 text-sm text-gray-700">{e.notes}</p> : null}
                  {e.payload && Object.keys(e.payload).length > 0 ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  ) : null}
                  {e.client_event_id ? (
                    <p className="mt-1 text-[10px] text-gray-400">
                      client_event_id: <code>{e.client_event_id}</code>
                      {e.stock_ledger_id ? ` · stock_ledger_id: ${e.stock_ledger_id}` : ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Condition history */}
        {conditions.length > 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <header className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-medium text-gray-900">Condition history</h2>
            </header>
            <ol className="divide-y divide-gray-100 text-sm">
              {conditions.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-3 px-6 py-3">
                  <span className="text-xs text-gray-500">
                    {new Date(c.assessed_at).toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-700">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5">{c.prev_grade ?? '—'}</code>{' '}
                    →{' '}
                    <code className="rounded bg-gray-100 px-1.5 py-0.5">{c.new_grade}</code>
                  </span>
                  <span className="ml-auto text-xs text-gray-500">
                    {c.assessed_by_name ?? (c.assessed_by_staff_id ? `#${c.assessed_by_staff_id}` : 'system')}
                  </span>
                  {c.cosmetic_notes || c.functional_notes ? (
                    <div className="basis-full text-sm text-gray-700">
                      {c.cosmetic_notes ? <p>cosmetic: {c.cosmetic_notes}</p> : null}
                      {c.functional_notes ? <p>functional: {c.functional_notes}</p> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Allocations */}
        {allocations.length > 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <header className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-medium text-gray-900">Order allocations</h2>
            </header>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-2 text-left font-medium">Order</th>
                  <th className="px-6 py-2 text-left font-medium">Allocated</th>
                  <th className="px-6 py-2 text-left font-medium">State</th>
                  <th className="px-6 py-2 text-left font-medium">Released</th>
                  <th className="px-6 py-2 text-left font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="px-6 py-2 font-mono text-xs">#{a.order_id}</td>
                    <td className="px-6 py-2 text-xs text-gray-500">
                      {new Date(a.allocated_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-2"><StatusBadge status={a.state} /></td>
                    <td className="px-6 py-2 text-xs text-gray-500">
                      {a.released_at ? new Date(a.released_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-6 py-2 text-xs text-gray-600">{a.released_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* TSN cross-refs */}
        {tsnLinks.length > 0 ? (
          <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <header className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-medium text-gray-900">tech_serial_numbers links</h2>
              <p className="mt-1 text-xs text-gray-500">
                Legacy audit table. Helpful when joining v1 tech-station logs to v2 lifecycle.
              </p>
            </header>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-2 text-left font-medium">TSN id</th>
                  <th className="px-6 py-2 text-left font-medium">When</th>
                  <th className="px-6 py-2 text-left font-medium">Station</th>
                  <th className="px-6 py-2 text-left font-medium">Type</th>
                  <th className="px-6 py-2 text-left font-medium">Shipment</th>
                  <th className="px-6 py-2 text-left font-medium">Tested by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tsnLinks.map((t) => (
                  <tr key={t.id}>
                    <td className="px-6 py-2 font-mono text-xs">{t.id}</td>
                    <td className="px-6 py-2 text-xs text-gray-500">
                      {new Date(t.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-2 text-xs">{t.station_source ?? '—'}</td>
                    <td className="px-6 py-2 text-xs">{t.serial_type}</td>
                    <td className="px-6 py-2 text-xs">{t.shipment_id ?? '—'}</td>
                    <td className="px-6 py-2 text-xs">{t.tested_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}
