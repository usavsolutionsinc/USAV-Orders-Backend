import Link from 'next/link';
import type {
  AllocationRow,
  DriftAlertRow,
  DriftRow,
  RecentEventRow,
} from './inventory-admin-data';

/** Open DRIFT alerts — surfaced by /api/qstash/inventory/drift-check. */
export function DriftAlertsSection({ openDriftAlerts }: { openDriftAlerts: DriftAlertRow[] }) {
  if (openDriftAlerts.length === 0) return null;
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 shadow-sm">
      <header className="flex items-center justify-between border-b border-red-100 px-6 py-4">
        <h2 className="text-lg font-medium text-red-900">Open DRIFT alerts</h2>
        <span className="rounded-full bg-red-200 px-3 py-1 text-xs font-medium text-red-800">
          {openDriftAlerts.length} open
        </span>
      </header>
      <table className="min-w-full divide-y divide-red-100 text-sm">
        <thead className="bg-red-100/50 text-xs uppercase tracking-wide text-red-700">
          <tr>
            <th className="px-6 py-2 text-left font-medium">SKU</th>
            <th className="px-6 py-2 text-right font-medium">Worst |Δ|</th>
            <th className="px-6 py-2 text-left font-medium">Triggered</th>
            <th className="px-6 py-2 text-left font-medium">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-red-100">
          {openDriftAlerts.map((a) => (
            <tr key={a.id}>
              <td className="px-6 py-2 font-mono text-xs">
                <a href={`/admin/inventory/sku/${encodeURIComponent(a.sku)}`} className="text-red-700 hover:underline">
                  {a.sku}
                </a>
              </td>
              <td className="px-6 py-2 text-right font-semibold text-red-700">{a.qty_at_trigger ?? '—'}</td>
              <td className="px-6 py-2 text-xs text-red-700">{new Date(a.triggered_at).toLocaleString()}</td>
              <td className="px-6 py-2 font-mono text-caption text-gray-700">{a.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** sku_stock ↔ ledger drift report. */
export function DriftSection({ drift, driftClean }: { drift: DriftRow[]; driftClean: boolean }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">SKU stock drift</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${driftClean ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {driftClean ? 'clean' : `${drift.length} SKUs out of sync`}
        </span>
      </header>
      {driftClean ? (
        <p className="px-6 py-4 text-sm text-gray-600">
          sku_stock.stock equals SUM(sku_stock_ledger.delta) for every SKU. The trigger is working.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2 text-left font-medium">SKU</th>
                <th className="px-6 py-2 text-right font-medium">Stored WH</th>
                <th className="px-6 py-2 text-right font-medium">Ledger WH</th>
                <th className="px-6 py-2 text-right font-medium">Δ WH</th>
                <th className="px-6 py-2 text-right font-medium">Stored Boxed</th>
                <th className="px-6 py-2 text-right font-medium">Ledger Boxed</th>
                <th className="px-6 py-2 text-right font-medium">Δ Boxed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {drift.map((d) => (
                <tr key={d.sku}>
                  <td className="px-6 py-2 font-mono text-xs">{d.sku}</td>
                  <td className="px-6 py-2 text-right">{d.stored_stock}</td>
                  <td className="px-6 py-2 text-right">{d.ledger_warehouse}</td>
                  <td className={`px-6 py-2 text-right font-semibold ${d.warehouse_drift === 0 ? 'text-gray-400' : 'text-red-700'}`}>
                    {d.warehouse_drift > 0 ? '+' : ''}{d.warehouse_drift}
                  </td>
                  <td className="px-6 py-2 text-right">{d.stored_boxed}</td>
                  <td className="px-6 py-2 text-right">{d.ledger_boxed}</td>
                  <td className={`px-6 py-2 text-right font-semibold ${d.boxed_drift === 0 ? 'text-gray-400' : 'text-red-700'}`}>
                    {d.boxed_drift > 0 ? '+' : ''}{d.boxed_drift}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Open allocation summary by state. */
export function AllocationsSection({ allocations }: { allocations: AllocationRow[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Order unit allocations</h2>
        <Link
          href="/admin/inventory/bulk-allocate"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Bulk allocate →
        </Link>
      </header>
      {allocations.length === 0 ? (
        <p className="px-6 py-4 text-sm text-gray-600">
          No allocations yet. Orders auto-allocate against STOCKED units on intake.
        </p>
      ) : (
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-6 py-2 text-left font-medium">State</th>
              <th className="px-6 py-2 text-right font-medium">Count</th>
              <th className="px-6 py-2 text-left font-medium">Oldest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {allocations.map((a) => (
              <tr key={a.state}>
                <td className="px-6 py-2 font-mono text-xs">{a.state}</td>
                <td className="px-6 py-2 text-right">{a.count}</td>
                <td className="px-6 py-2 text-xs text-gray-500">{a.oldest ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Recent inventory_events (last 50, with status diff + actor). */
export function RecentEventsSection({ events }: { events: RecentEventRow[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Recent inventory events</h2>
          <p className="mt-1 text-xs text-gray-500">Last 50 across all phases. Empty until a flagged path emits.</p>
        </div>
        <Link
          href="/admin/inventory/events"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Open explorer →
        </Link>
      </header>
      {events.length === 0 ? (
        <p className="px-6 py-4 text-sm text-gray-600">No events yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2 text-left font-medium">When</th>
                <th className="px-6 py-2 text-left font-medium">Event</th>
                <th className="px-6 py-2 text-left font-medium">Station</th>
                <th className="px-6 py-2 text-left font-medium">Unit / SKU</th>
                <th className="px-6 py-2 text-left font-medium">Status</th>
                <th className="px-6 py-2 text-left font-medium">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-6 py-2 text-xs text-gray-500">
                    {new Date(e.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-2 font-mono text-xs">{e.event_type}</td>
                  <td className="px-6 py-2 text-xs text-gray-600">{e.station ?? '—'}</td>
                  <td className="px-6 py-2 text-xs">
                    {e.serial_unit_id ? (
                      <Link href={`/admin/inventory/units/${e.serial_unit_id}`} className="text-blue-600 hover:underline">
                        #{e.serial_unit_id}
                      </Link>
                    ) : null}
                    {e.serial_unit_id && e.sku ? <span className="px-1 text-gray-300">·</span> : null}
                    {e.sku ? (
                      <Link href={`/admin/inventory/sku/${encodeURIComponent(e.sku)}`} className="text-blue-600 hover:underline">
                        {e.sku}
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-6 py-2 text-xs text-gray-600">
                    {e.prev_status && e.next_status
                      ? `${e.prev_status} → ${e.next_status}`
                      : e.next_status ?? '—'}
                  </td>
                  <td className="px-6 py-2 text-xs">
                    {e.actor_name ?? (e.actor_staff_id ? `#${e.actor_staff_id}` : 'system')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
