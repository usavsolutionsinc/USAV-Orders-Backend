import { requirePermission } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/ui/pane-header';
import { loadInventoryAdminData } from './_inventory-admin/inventory-admin-data';
import { LookupForms } from './_inventory-admin/LookupForms';
import {
  FlagsSection,
  PreflightSection,
  QuickLinks,
  SchemaSection,
  BackfillSection,
} from './_inventory-admin/StatusSections';
import {
  DriftAlertsSection,
  DriftSection,
  AllocationsSection,
  RecentEventsSection,
} from './_inventory-admin/TableSections';

export const dynamic = 'force-dynamic';

/**
 * /admin/inventory — Operations dashboard for the inventory v2 rollout.
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
 * one slow query doesn't block the rest of the page. Data loading + the
 * preflight derivation live in {@link loadInventoryAdminData}; every section
 * is a presentational component under `./_inventory-admin/`.
 */
export default async function InventoryAdminPage() {
  const user = await requirePermission('admin.view', { enforce: true });
  const data = await loadInventoryAdminData(user.organizationId);

  return (
    <div className="min-h-screen w-full bg-gray-50">
      <PageHeader title="Inventory" maxWidth="7xl" />
      <div className="mx-auto max-w-7xl space-y-8 p-8">
        <p className="text-sm text-gray-600">
          Operations dashboard for the state-machine inventory migration. Read-only.
          See <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">context/inventory_system_upgrade_plan.md</code> for the full plan.
        </p>

        <LookupForms />

        <FlagsSection flags={data.flags} allFlagsOff={data.allFlagsOff} />
        <PreflightSection preflight={data.preflight} preflightAllOk={data.preflightAllOk} />
        <QuickLinks />
        <DriftAlertsSection openDriftAlerts={data.openDriftAlerts} />
        <SchemaSection schema={data.schema} schemaAllOk={data.schemaAllOk} />
        <BackfillSection backfill={data.backfill} />
        <DriftSection drift={data.drift} driftClean={data.driftClean} />
        <AllocationsSection allocations={data.allocations} />
        <RecentEventsSection events={data.events} />

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
