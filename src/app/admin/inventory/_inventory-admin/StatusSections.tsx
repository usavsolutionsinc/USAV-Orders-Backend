import Link from 'next/link';
import type {
  BackfillRow,
  FlagRow,
  PreflightCheck,
  SchemaRow,
} from './inventory-admin-data';

/** Feature flag snapshot — documents the live (always-on) lifecycle phases. */
export function FlagsSection({ flags, allFlagsOff }: { flags: FlagRow[]; allFlagsOff: boolean }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Feature flags</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${allFlagsOff ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-700'}`}>
          {allFlagsOff ? 'All OFF — legacy paths active' : `${flags.filter((f) => f.on).length} of ${flags.length} ON`}
        </span>
      </header>
      <table className="min-w-full divide-y divide-gray-100">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-6 py-2 text-left font-medium">Env var</th>
            <th className="px-6 py-2 text-left font-medium">Phase</th>
            <th className="px-6 py-2 text-left font-medium">State</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-sm">
          {flags.map((f) => (
            <tr key={f.key}>
              <td className="px-6 py-3 font-mono text-xs text-gray-700">{f.key}</td>
              <td className="px-6 py-3 text-gray-600">{f.phase}</td>
              <td className="px-6 py-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${f.on ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {f.on ? 'ON' : 'OFF'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Preflight — gating checks that should be green before flipping any phase flag. */
export function PreflightSection({ preflight, preflightAllOk }: { preflight: PreflightCheck[]; preflightAllOk: boolean }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Preflight</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${preflightAllOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {preflightAllOk ? 'all green — safe to flip flags' : 'attention required'}
        </span>
      </header>
      <ul className="divide-y divide-gray-100">
        {preflight.map((c) => {
          const dot =
            c.status === 'pass' ? 'bg-green-500' :
            c.status === 'warn' ? 'bg-amber-500' :
            'bg-red-500';
          const label =
            c.status === 'pass' ? 'PASS' :
            c.status === 'warn' ? 'WARN' :
            'FAIL';
          return (
            <li key={c.label} className="flex items-start gap-3 px-6 py-3">
              <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="text-sm font-medium text-gray-900">{c.label}</span>
                  <span className={`text-micro font-bold uppercase tracking-wider ${
                    c.status === 'pass' ? 'text-green-700' :
                    c.status === 'warn' ? 'text-amber-700' :
                    'text-red-700'
                  }`}>
                    {label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <footer className="border-t border-gray-100 bg-gray-50 px-6 py-3 text-xs text-gray-600">
        Phase-specific data preconditions:
        <span className="ml-1">
          Phase 5 (PACKING) requires Phase 4 (ALLOCATION) flipped first so
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5">order_unit_allocations</code>
          rows exist for /api/pack/ship to accept.
        </span>
      </footer>
    </section>
  );
}

/** Quick links to operations tools. */
export function QuickLinks() {
  return (
    <nav className="flex flex-wrap gap-2">
      <Link href="/admin/inventory/events" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Events explorer →
      </Link>
      <Link href="/admin/inventory/bulk-allocate" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Bulk allocate →
      </Link>
      <Link href="/admin/inventory/holds" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Holds →
      </Link>
      <Link href="/admin/inventory/returns" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Returns intake →
      </Link>
      <Link href="/admin/inventory/throughput" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Throughput →
      </Link>
      <Link href="/admin/inventory/cycle-counts" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
        Cycle counts →
      </Link>
    </nav>
  );
}

/** Schema artifact presence check. */
export function SchemaSection({ schema, schemaAllOk }: { schema: SchemaRow[]; schemaAllOk: boolean }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Schema artifacts</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${schemaAllOk ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {schemaAllOk ? 'all present' : `${schema.filter((s) => !s.exists).length} missing`}
        </span>
      </header>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-6 py-4 text-sm md:grid-cols-2">
        {schema.map((s) => (
          <li key={s.artifact} className="flex items-center gap-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.exists ? 'bg-green-500' : 'bg-red-500'}`} />
            <code className="text-xs text-gray-700">{s.artifact}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Backfill progress stats (tech_serial_numbers → serial_units linkage). */
export function BackfillSection({ backfill }: { backfill: BackfillRow | null }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-lg font-medium text-gray-900">Backfill progress</h2>
      </header>
      {backfill ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">tech_serial_numbers total</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{backfill.total_tsn}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">linked to serial_units</dt>
            <dd className="mt-1 text-2xl font-semibold text-green-700">{backfill.linked_tsn}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">unlinked (eligible)</dt>
            <dd className={`mt-1 text-2xl font-semibold ${backfill.unlinked_eligible === 0 ? 'text-gray-400' : 'text-amber-600'}`}>
              {backfill.unlinked_eligible}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">serial_units rows</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{backfill.serial_units_total}</dd>
          </div>
        </dl>
      ) : (
        <p className="px-6 py-4 text-sm text-amber-700">Backfill stats unavailable.</p>
      )}
    </section>
  );
}
