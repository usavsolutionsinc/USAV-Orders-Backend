import { requirePermission } from '@/lib/auth/page-guard';
import { queryRaw } from '@/lib/neon-client';
import { inventoryV2FlagSnapshot } from '@/lib/feature-flags';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/** Server action: redirect to the per-unit timeline page on form submit. */
async function lookupUnit(formData: FormData): Promise<void> {
  'use server';
  const ref = String(formData.get('ref') ?? '').trim();
  if (ref) redirect(`/admin/inventory-v2/units/${encodeURIComponent(ref)}`);
  redirect('/admin/inventory-v2');
}

/** Server action: redirect to the SKU detail page on form submit. */
async function lookupSku(formData: FormData): Promise<void> {
  'use server';
  const sku = String(formData.get('sku') ?? '').trim();
  if (sku) redirect(`/admin/inventory-v2/sku/${encodeURIComponent(sku)}`);
  redirect('/admin/inventory-v2');
}

/**
 * /admin/inventory-v2 — Operations dashboard for the inventory v2 rollout.
 *
 * Read-only server component. Surfaces:
 *   - Flag snapshot (which phases are ON)
 *   - Schema artifact check (Phase 0/1 tables + enum values present)
 *   - Backfill progress (TSN linked vs unlinked, serial_units count)
 *   - sku_stock drift report (v_sku_stock_drift — should be empty)
 *   - Open allocation summary (count + oldest)
 *   - Recent inventory_events (last 50, with status diff + actor)
 *
 * Gated by admin.view at the route level. Each query is independent;
 * one slow query doesn't block the rest of the page.
 */

interface FlagRow {
  key: string;
  on: boolean;
  phase: string;
}

interface SchemaRow {
  artifact: string;
  exists: boolean;
}

interface BackfillRow {
  total_tsn: number;
  linked_tsn: number;
  unlinked_eligible: number;
  serial_units_total: number;
}

interface DriftRow {
  sku: string;
  stored_stock: number;
  ledger_warehouse: number;
  warehouse_drift: number;
  stored_boxed: number;
  ledger_boxed: number;
  boxed_drift: number;
}

interface AllocationRow {
  state: string;
  count: string;
  oldest: string | null;
}

interface RecentEventRow {
  id: number;
  occurred_at: Date;
  event_type: string;
  station: string | null;
  sku: string | null;
  serial_unit_id: number | null;
  prev_status: string | null;
  next_status: string | null;
  actor_staff_id: number | null;
  actor_name: string | null;
}

async function loadFlags(): Promise<FlagRow[]> {
  const snap = inventoryV2FlagSnapshot();
  const phaseMap: Record<string, string> = {
    INVENTORY_V2_RECEIVING_PUTAWAY: 'Phase 2 — receive+putaway',
    INVENTORY_V2_TECH_LIFECYCLE: 'Phase 3 — tech lifecycle',
    INVENTORY_V2_ALLOCATION: 'Phase 4 — allocation + pick',
    INVENTORY_V2_PACKING: 'Phase 5 — pack/ship decrement',
    INVENTORY_V2_FBA_SERIAL_LINK: 'Phase 6 — FBA serial linkage',
    INVENTORY_V2_RETURNS: 'Phase 7 — returns + holds',
  };
  return Object.entries(snap).map(([key, on]) => ({ key, on, phase: phaseMap[key] ?? key }));
}

async function loadSchema(): Promise<SchemaRow[]> {
  const expectedTables = [
    'serial_units',
    'inventory_events',
    'sku_stock_ledger',
    'serial_unit_condition_history',
    'order_unit_allocations',
    'fba_shipment_item_units',
    'unit_id_sequences',
  ];
  const expectedEnumValues = [
    'TRIAGED', 'IN_REPAIR', 'REPAIR_DONE', 'IN_TEST', 'GRADED',
    'ALLOCATED', 'PACKED', 'LABELED', 'STAGED', 'ON_HOLD',
  ];
  try {
    const tables = await queryRaw<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [expectedTables],
    );
    const presentTables = new Set(tables.map((t) => t.table_name));
    const enums = await queryRaw<{ v: string }>(
      `SELECT unnest(enum_range(NULL::serial_status_enum))::text AS v`,
    );
    const presentEnums = new Set(enums.map((e) => e.v));
    const fn = await queryRaw<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='fn_next_unit_seq') AS exists`,
    );
    return [
      ...expectedTables.map((t) => ({ artifact: `table: ${t}`, exists: presentTables.has(t) })),
      ...expectedEnumValues.map((v) => ({
        artifact: `enum: serial_status_enum.${v}`,
        exists: presentEnums.has(v),
      })),
      { artifact: 'fn: fn_next_unit_seq(int,int)', exists: fn[0]?.exists ?? false },
    ];
  } catch (err) {
    return [{ artifact: `schema check failed: ${err instanceof Error ? err.message : String(err)}`, exists: false }];
  }
}

async function loadBackfill(): Promise<BackfillRow | null> {
  try {
    const tsn = await queryRaw<{ total_tsn: number; linked_tsn: number; unlinked_eligible: number }>(
      `SELECT
         COUNT(*)::int AS total_tsn,
         COUNT(serial_unit_id)::int AS linked_tsn,
         COUNT(*) FILTER (
           WHERE serial_unit_id IS NULL
             AND serial_number IS NOT NULL
             AND BTRIM(serial_number) <> ''
             AND COALESCE(UPPER(serial_type),'SERIAL') <> 'FNSKU'
         )::int AS unlinked_eligible
       FROM tech_serial_numbers`,
    );
    const su = await queryRaw<{ n: number }>(`SELECT COUNT(*)::int AS n FROM serial_units`);
    return {
      total_tsn: tsn[0]?.total_tsn ?? 0,
      linked_tsn: tsn[0]?.linked_tsn ?? 0,
      unlinked_eligible: tsn[0]?.unlinked_eligible ?? 0,
      serial_units_total: su[0]?.n ?? 0,
    };
  } catch {
    return null;
  }
}

async function loadDrift(): Promise<DriftRow[]> {
  try {
    return await queryRaw<DriftRow>(
      `SELECT sku, stored_stock, ledger_warehouse, warehouse_drift,
              stored_boxed, ledger_boxed, boxed_drift
         FROM v_sku_stock_drift
        ORDER BY ABS(warehouse_drift) + ABS(boxed_drift) DESC
        LIMIT 25`,
    );
  } catch {
    return [];
  }
}

async function loadAllocations(): Promise<AllocationRow[]> {
  try {
    return await queryRaw<AllocationRow>(
      `SELECT state::text AS state,
              COUNT(*)::text AS count,
              MIN(allocated_at)::text AS oldest
         FROM order_unit_allocations
        GROUP BY state
        ORDER BY state`,
    );
  } catch {
    return [];
  }
}

interface GtinCoverageRow {
  total: number;
  with_gtin: number;
  without_gtin: number;
}

async function loadGtinCoverage(): Promise<GtinCoverageRow | null> {
  try {
    const r = await queryRaw<GtinCoverageRow>(
      `SELECT COUNT(*)::int                                                AS total,
              COUNT(*) FILTER (WHERE gtin IS NOT NULL AND BTRIM(gtin) <> '')::int AS with_gtin,
              COUNT(*) FILTER (WHERE gtin IS NULL OR BTRIM(gtin) = '')::int      AS without_gtin
         FROM sku_catalog`,
    );
    return r[0] ?? null;
  } catch {
    return null;
  }
}

interface DriftAlertRow {
  id: number;
  sku: string;
  qty_at_trigger: number | null;
  triggered_at: Date;
  notes: string | null;
}

async function loadOpenDriftAlerts(): Promise<DriftAlertRow[]> {
  try {
    return await queryRaw<DriftAlertRow>(
      `SELECT id, sku, qty_at_trigger, triggered_at, notes
         FROM stock_alerts
        WHERE alert_type = 'DRIFT'
          AND resolved_at IS NULL
        ORDER BY triggered_at DESC, id DESC
        LIMIT 25`,
    );
  } catch {
    return [];
  }
}

async function loadRecentEvents(): Promise<RecentEventRow[]> {
  try {
    return await queryRaw<RecentEventRow>(
      `SELECT ie.id, ie.occurred_at, ie.event_type, ie.station,
              ie.sku, ie.serial_unit_id,
              ie.prev_status, ie.next_status,
              ie.actor_staff_id, s.name AS actor_name
         FROM inventory_events ie
         LEFT JOIN staff s ON s.id = ie.actor_staff_id
        ORDER BY ie.occurred_at DESC, ie.id DESC
        LIMIT 50`,
    );
  } catch {
    return [];
  }
}

export default async function InventoryV2AdminPage() {
  await requirePermission('admin.view', { enforce: true });

  const [flags, schema, backfill, drift, allocations, events, gtinCoverage, openDriftAlerts] = await Promise.all([
    loadFlags(),
    loadSchema(),
    loadBackfill(),
    loadDrift(),
    loadAllocations(),
    loadRecentEvents(),
    loadGtinCoverage(),
    loadOpenDriftAlerts(),
  ]);

  const allFlagsOff = flags.every((f) => !f.on);
  const schemaAllOk = schema.every((s) => s.exists);
  const driftClean = drift.length === 0;

  // Preflight: the gating conditions that should be green before flipping
  // ANY phase flag. Per-phase data preconditions (e.g. Phase 5 needs Phase 4
  // allocations) are noted in the row body rather than baked into the
  // status colour, since they require live operational data to validate.
  type CheckStatus = 'pass' | 'warn' | 'fail';
  const tsnBackfillOk = (backfill?.unlinked_eligible ?? 1) === 0;
  const gtinBackfillOk = (gtinCoverage?.without_gtin ?? 1) === 0;
  const openDriftCount = openDriftAlerts.length;

  const preflight: Array<{ label: string; status: CheckStatus; detail: string }> = [
    {
      label: 'Schema artifacts',
      status: schemaAllOk ? 'pass' : 'fail',
      detail: schemaAllOk
        ? 'All Phase 0/1 tables, enum values, and fn_next_unit_seq present.'
        : `${schema.filter((s) => !s.exists).length} artifact(s) missing — run migrations.`,
    },
    {
      label: 'tech_serial_numbers backfill',
      status: tsnBackfillOk ? 'pass' : 'warn',
      detail: tsnBackfillOk
        ? `${backfill?.linked_tsn ?? 0} of ${backfill?.total_tsn ?? 0} linked; 0 eligible remaining.`
        : `${backfill?.unlinked_eligible ?? '?'} eligible row(s) still NULL — run scripts/backfill-tech-serial-unit-id.mjs.`,
    },
    {
      label: 'sku_catalog GTIN coverage',
      status: gtinBackfillOk ? 'pass' : 'warn',
      detail: gtinCoverage
        ? gtinBackfillOk
          ? `${gtinCoverage.with_gtin} of ${gtinCoverage.total} SKUs stamped.`
          : `${gtinCoverage.without_gtin} SKU(s) without a GTIN — run scripts/backfill-internal-gtins.mjs.`
        : 'unable to query sku_catalog.',
    },
    {
      label: 'sku_stock ↔ ledger drift',
      status: driftClean && openDriftCount === 0 ? 'pass' : driftClean ? 'warn' : 'fail',
      detail: driftClean
        ? openDriftCount === 0
          ? 'v_sku_stock_drift is empty; no open DRIFT alerts.'
          : `v_sku_stock_drift is empty but ${openDriftCount} open DRIFT alert(s) — next drift-check run will resolve.`
        : `${drift.length} SKU(s) currently drifting — fix before flipping any inventory v2 flag.`,
    },
  ];
  const preflightAllOk = preflight.every((p) => p.status === 'pass');

  return (
    <div className="min-h-screen w-full bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold text-gray-900">Inventory v2 Rollout</h1>
          <p className="text-sm text-gray-600">
            Operations dashboard for the state-machine inventory migration. Read-only.
            See <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">context/inventory_system_upgrade_plan.md</code> for the full plan.
          </p>
        </header>

        {/* Lookup forms — side by side on md+, stacked on mobile */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <form action={lookupUnit} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <label htmlFor="ref" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Unit
            </label>
            <input
              id="ref"
              name="ref"
              type="text"
              placeholder="serial or id"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              Timeline →
            </button>
          </form>

          <form action={lookupSku} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <label htmlFor="sku" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              SKU
            </label>
            <input
              id="sku"
              name="sku"
              type="text"
              placeholder="SKU code"
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              Detail →
            </button>
          </form>
        </div>

        {/* Feature flag snapshot */}
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

        {/* Preflight — gating checks for flipping any phase flag */}
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
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
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

        {/* Open DRIFT alerts — surfaced by /api/qstash/inventory/drift-check */}
        {openDriftAlerts.length > 0 ? (
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
                      <a href={`/admin/inventory-v2/sku/${encodeURIComponent(a.sku)}`} className="text-red-700 hover:underline">
                        {a.sku}
                      </a>
                    </td>
                    <td className="px-6 py-2 text-right font-semibold text-red-700">{a.qty_at_trigger ?? '—'}</td>
                    <td className="px-6 py-2 text-xs text-red-700">{new Date(a.triggered_at).toLocaleString()}</td>
                    <td className="px-6 py-2 font-mono text-[11px] text-gray-700">{a.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* Schema artifacts */}
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

        {/* Backfill progress */}
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

        {/* sku_stock drift */}
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

        {/* Allocations summary */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-medium text-gray-900">Order unit allocations</h2>
          </header>
          {allocations.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-600">
              No allocations yet. Phase 4 (<code>INVENTORY_V2_ALLOCATION</code>) is the gate.
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

        {/* Recent inventory_events */}
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <header className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-medium text-gray-900">Recent inventory events</h2>
            <p className="mt-1 text-xs text-gray-500">Last 50 across all phases. Empty until a flagged path emits.</p>
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
                          <Link href={`/admin/inventory-v2/units/${e.serial_unit_id}`} className="text-blue-600 hover:underline">
                            #{e.serial_unit_id}
                          </Link>
                        ) : null}
                        {e.serial_unit_id && e.sku ? <span className="px-1 text-gray-300">·</span> : null}
                        {e.sku ? (
                          <Link href={`/admin/inventory-v2/sku/${encodeURIComponent(e.sku)}`} className="text-blue-600 hover:underline">
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

        <footer className="pt-2 text-xs text-gray-500">
          <p>
            To flip a flag, set the corresponding env var to <code className="rounded bg-gray-100 px-1 py-0.5">true</code>
            on Vercel and redeploy. The flag reads on every request — no warm-up needed.
          </p>
        </footer>
      </div>
    </div>
  );
}
