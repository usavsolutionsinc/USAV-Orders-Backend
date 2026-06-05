import Link from 'next/link';
import { OperationsFlowsDisplay } from './OperationsFlowsDisplay';
import { ReasonCodesManagementTab } from '@/components/admin/ReasonCodesManagementTab';

type OperationsMode = 'flows' | 'reasons';

/**
 * Container for the admin "Operations" section. Hosts the read-only system-flow
 * board (default) plus the Reason Codes CRUD editor as a second mode. Reason
 * Codes used to be its own top-level admin section; it now lives here, gated by
 * `sku_stock.manage` so the editing surface keeps its original permission.
 *
 * Mode is driven by `?mode=` so it round-trips through the admin sidebar's
 * server-rendered `?section=` navigation without extra client state.
 */
export function OperationsSection({
  mode,
  canManageStock,
}: {
  mode?: string;
  canManageStock: boolean;
}) {
  // Reason Codes is only reachable by users who can manage stock; everyone else
  // silently falls back to the flow board even if the URL asks for it.
  const activeMode: OperationsMode = mode === 'reasons' && canManageStock ? 'reasons' : 'flows';

  const pillClass = (isActive: boolean) =>
    [
      'rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100',
    ].join(' ');

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2">
        <Link href="/admin?section=architecture" className={pillClass(activeMode === 'flows')}>
          Flows
        </Link>
        {canManageStock ? (
          <Link href="/admin?section=architecture&mode=reasons" className={pillClass(activeMode === 'reasons')}>
            Reason Codes
          </Link>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeMode === 'reasons' ? <ReasonCodesManagementTab /> : <OperationsFlowsDisplay />}
      </div>
    </div>
  );
}
