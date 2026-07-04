'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fbaPaths } from '@/lib/fba/api-paths';
import { Loader2, Minus } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { formatDateTimePST } from '@/utils/date';
import { FbaStatusBadge } from '@/components/fba/shared/FbaStatusBadge';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import {
  fbaShipmentsQuery,
  type FBAShipmentLifecycleRow,
  type FBAShipmentLegacyRow,
} from '@/lib/queries/dashboard-queries';

function StatusBadge({ status }: { status: string }) {
  return <FbaStatusBadge status={status} size="xs" />;
}

function ReadinessBar({ ready, total }: { ready: number; total: number }) {
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden w-16">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-micro font-bold text-text-soft tabular-nums">{ready}/{total}</span>
    </div>
  );
}

function QtyCellWithRemove({ row }: { row: FBAShipmentLifecycleRow }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const totalItems = Number(row.total_items) || 0;
  const readyItems =
    Number(row.ready_items) + Number(row.labeled_items) + Number(row.shipped_items);
  const canRemove = row.status === 'PLANNED' && totalItems === 1 && readyItems === 0;

  const removeSinglePlannedItem = async () => {
    if (!canRemove || busy) return;
    setBusy(true);
    try {
      const itemsRes = await fetch(fbaPaths.planItems(row.id), { cache: 'no-store' });
      const data = await itemsRes.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length !== 1 || String(items[0].status) !== 'PLANNED') return;
      const del = await fetch(fbaPaths.planItem(row.id, items[0].id), {
        method: 'DELETE',
      });
      if (del.ok) {
        await queryClient.invalidateQueries({ queryKey: ['dashboard-fba-shipments'] });
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono">
        <span
          className={
            Number(row.total_actual_qty) < Number(row.total_expected_qty)
              ? 'text-amber-600'
              : 'text-emerald-600'
          }
        >
          {row.total_actual_qty}
        </span>
        <span className="text-text-soft">/{row.total_expected_qty}</span>
      </span>
      {canRemove ? (
        <HoverTooltip label="Remove the only line from this plan" asChild>
          <IconButton
            type="button"
            onClick={() => void removeSinglePlannedItem()}
            disabled={busy}
            ariaLabel="Remove item from plan"
            icon={
              busy ? (
                <Loader2 className="h-3 w-3 animate-spin text-red-600" />
              ) : (
                <Minus className="h-3 w-3 text-red-600" />
              )
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-40"
          />
        </HoverTooltip>
      ) : null}
    </div>
  );
}

function enumLabel(value: string | null | undefined) {
  return String(value || '').replaceAll('_', ' ') || '-';
}

export default function FBAShipmentsTable() {
  const { data, isLoading, isError } = useQuery({
    ...fbaShipmentsQuery(),
    refetchInterval: 60_000,
  });

  const rows = data?.rows ?? [];
  const source = data?.source ?? 'unknown';
  const isLegacy = source === 'legacy';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-canvas">
        <p className="text-sm font-black uppercase tracking-widest text-red-600">Failed to load FBA shipments</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-card">
      <div className="border-b border-border-soft bg-purple-50 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight text-purple-900">FBA Shipments</h2>
            <p className={`mt-1 ${sectionLabel} text-purple-500`}>
              {isLegacy ? 'Receiving Queue (legacy)' : 'Shipment Lifecycle Board'} — {rows.length} shipments
            </p>
          </div>
          {isLegacy && (
            <span className="text-eyebrow font-black uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg">
              Run migration to enable lifecycle view
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-caption font-black uppercase tracking-widest text-text-soft">No FBA shipments</p>
          </div>
        ) : isLegacy ? (
          /* ── Legacy table (pre-migration) ── */
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 bg-surface-card">
              <tr className="border-b border-border-soft text-left text-micro font-black uppercase tracking-widest text-text-soft">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Carrier</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">QA</th>
                <th className="px-3 py-2">Disposition</th>
                <th className="px-3 py-2">Needs Test</th>
                <th className="px-3 py-2">Assigned Tech</th>
                <th className="px-3 py-2">Received At</th>
              </tr>
            </thead>
            <tbody>
              {(rows as FBAShipmentLegacyRow[]).map((row) => (
                <tr key={row.id} className="border-b border-border-hairline text-caption font-bold text-text-muted hover:bg-surface-hover">
                  <td className="px-3 py-2 font-mono">{row.id}</td>
                  <td className="px-3 py-2 font-mono text-purple-700">{row.shipment_ref || '-'}</td>
                  <td className="px-3 py-2">{row.carrier || '-'}</td>
                  <td className="px-3 py-2">{enumLabel(row.condition_grade)}</td>
                  <td className="px-3 py-2">{enumLabel(row.qa_status)}</td>
                  <td className="px-3 py-2">{enumLabel(row.disposition_code)}</td>
                  <td className="px-3 py-2">{row.needs_test ? 'YES' : 'NO'}</td>
                  <td className="px-3 py-2">{row.assigned_tech_name || '-'}</td>
                  <td className="px-3 py-2">{row.received_at ? formatDateTimePST(row.received_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* ── Lifecycle table (post-migration) ── */
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr className="border-b border-border-soft text-left text-micro font-black uppercase tracking-widest text-text-soft">
                <th className="px-3 py-2">Shipment Ref</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Items Ready</th>
                <th className="px-3 py-2">Qty (Act/Exp)</th>
                <th className="px-3 py-2">FC</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2">Tech</th>
                <th className="px-3 py-2">Packer</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {(rows as FBAShipmentLifecycleRow[]).map((row) => {
                const totalItems = Number(row.total_items) || 0;
                const readyItems = Number(row.ready_items) + Number(row.labeled_items) + Number(row.shipped_items);
                return (
                  <tr key={row.id} className="border-b border-border-hairline text-caption font-bold text-text-muted hover:bg-purple-50 transition-colors">
                    <td className="px-3 py-2">
                      <span className="font-mono text-purple-700 font-black">{row.shipment_ref}</span>
                      {row.notes && (
                        <p className="text-eyebrow text-text-soft font-normal truncate max-w-[140px]">{row.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2">
                      <ReadinessBar ready={readyItems} total={totalItems} />
                    </td>
                    <td className="px-3 py-2">
                      <QtyCellWithRemove row={row} />
                    </td>
                    <td className="px-3 py-2 font-mono text-text-soft">{row.destination_fc || '-'}</td>
                    <td className="px-3 py-2">{row.due_date ? new Date(row.due_date).toLocaleDateString() : '-'}</td>
                    <td className="px-3 py-2">{row.assigned_tech_name || '-'}</td>
                    <td className="px-3 py-2">{row.assigned_packer_name || '-'}</td>
                    <td className="px-3 py-2 text-text-soft">{formatDateTimePST(row.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
