'use client';

import { usePoAuditDetail } from './receiving/usePoAuditDetail';
import { EmptyState } from './receiving/AuditPrimitives';
import { PODetailView } from './receiving/PODetailView';

/**
 * Receiving audit-log right pane: shows the full event timeline + cartons + lines
 * for the PO in the `?po=` URL param. Thin composition layer — data lives in
 * {@link usePoAuditDetail}; the views live under `./receiving/`.
 */
export function AuditLogReceivingClient() {
  const { selectedPo, detail, detailLoading, error } = usePoAuditDetail();

  return (
    <div className="flex h-full w-full overflow-y-auto">
      {error ? (
        <div className="m-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : !selectedPo ? (
        <EmptyState />
      ) : detailLoading ? (
        <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">Loading PO timeline…</div>
      ) : detail ? (
        <div className="w-full">
          <PODetailView detail={detail} />
        </div>
      ) : null}
    </div>
  );
}
