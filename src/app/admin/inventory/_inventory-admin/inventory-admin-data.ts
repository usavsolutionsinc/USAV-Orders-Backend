import { queryRaw } from '@/lib/neon-client';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface FlagRow {
  key: string;
  on: boolean;
  phase: string;
}

export interface SchemaRow {
  artifact: string;
  exists: boolean;
}

export interface BackfillRow {
  total_tsn: number;
  linked_tsn: number;
  unlinked_eligible: number;
  serial_units_total: number;
}

export interface DriftRow {
  sku: string;
  stored_stock: number;
  ledger_warehouse: number;
  warehouse_drift: number;
  stored_boxed: number;
  ledger_boxed: number;
  boxed_drift: number;
}

export interface AllocationRow {
  state: string;
  count: string;
  oldest: string | null;
}

export interface RecentEventRow {
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

export interface GtinCoverageRow {
  total: number;
  with_gtin: number;
  without_gtin: number;
}

export interface DriftAlertRow {
  id: number;
  sku: string;
  qty_at_trigger: number | null;
  triggered_at: Date;
  notes: string | null;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheck {
  label: string;
  status: CheckStatus;
  detail: string;
}

// The inventory system is V2-only and always-on — there are no longer any
// INVENTORY_V2_* feature flags to toggle. This table now documents the live
// lifecycle phases (all active) so the diagnostics page still reads as a map of
// what the unit-level engine covers.
async function loadFlags(): Promise<FlagRow[]> {
  const phases: Array<{ key: string; phase: string }> = [
    { key: 'RECEIVING_PUTAWAY', phase: 'Phase 2 — receive+putaway' },
    { key: 'TECH_LIFECYCLE', phase: 'Phase 3 — tech lifecycle' },
    { key: 'ALLOCATION', phase: 'Phase 4 — allocation + pick' },
    { key: 'PACKING', phase: 'Phase 5 — pack/ship decrement' },
    { key: 'FBA_SERIAL_LINK', phase: 'Phase 6 — FBA serial linkage' },
    { key: 'RETURNS', phase: 'Phase 7 — returns + holds' },
  ];
  return phases.map(({ key, phase }) => ({ key, on: true, phase }));
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

async function loadOpenDriftAlerts(orgId: OrgId): Promise<DriftAlertRow[]> {
  try {
    const r = await tenantQuery<DriftAlertRow>(
      orgId,
      `SELECT id, sku, qty_at_trigger, triggered_at, notes
         FROM stock_alerts
        WHERE alert_type = 'DRIFT'
          AND resolved_at IS NULL
          AND organization_id = $1
        ORDER BY triggered_at DESC, id DESC
        LIMIT 25`,
      [orgId],
    );
    return r.rows;
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

export interface InventoryAdminData {
  flags: FlagRow[];
  schema: SchemaRow[];
  backfill: BackfillRow | null;
  drift: DriftRow[];
  allocations: AllocationRow[];
  events: RecentEventRow[];
  gtinCoverage: GtinCoverageRow | null;
  openDriftAlerts: DriftAlertRow[];
  // Derived
  allFlagsOff: boolean;
  schemaAllOk: boolean;
  driftClean: boolean;
  preflight: PreflightCheck[];
  preflightAllOk: boolean;
}

/**
 * Load every inventory-diagnostics dataset in parallel (each query independent —
 * one slow/failed query never blocks the rest) and compute the derived preflight
 * gating checks. The page renders straight from this bag.
 */
export async function loadInventoryAdminData(orgId: OrgId): Promise<InventoryAdminData> {
  const [flags, schema, backfill, drift, allocations, events, gtinCoverage, openDriftAlerts] = await Promise.all([
    loadFlags(),
    loadSchema(),
    loadBackfill(),
    loadDrift(),
    loadAllocations(),
    loadRecentEvents(),
    loadGtinCoverage(),
    loadOpenDriftAlerts(orgId),
  ]);

  const allFlagsOff = flags.every((f) => !f.on);
  const schemaAllOk = schema.every((s) => s.exists);
  const driftClean = drift.length === 0;

  // Preflight: the gating conditions that should be green before flipping
  // ANY phase flag. Per-phase data preconditions (e.g. Phase 5 needs Phase 4
  // allocations) are noted in the row body rather than baked into the
  // status colour, since they require live operational data to validate.
  const tsnBackfillOk = (backfill?.unlinked_eligible ?? 1) === 0;
  const gtinBackfillOk = (gtinCoverage?.without_gtin ?? 1) === 0;
  const openDriftCount = openDriftAlerts.length;

  const preflight: PreflightCheck[] = [
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

  return {
    flags, schema, backfill, drift, allocations, events, gtinCoverage, openDriftAlerts,
    allFlagsOff, schemaAllOk, driftClean, preflight, preflightAllOk,
  };
}
