'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { formatDateTimePST } from '@/utils/date';

// Lifecycle row shape (post-migration)
interface FBAShipmentLifecycleRow {
  id: number;
  shipment_ref: string;
  destination_fc: string | null;
  due_date: string | null;
  status: 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  notes: string | null;
  shipped_at: string | null;
  created_at: string;
  created_by_name: string | null;
  assigned_tech_name: string | null;
  assigned_packer_name: string | null;
  total_items: number;
  ready_items: number;
  labeled_items: number;
  shipped_items: number;
  total_expected_qty: number;
  total_actual_qty: number;
  source: 'lifecycle';
}

// Legacy row shape (pre-migration fallback from receiving table)
interface FBAShipmentLegacyRow {
  id: number;
  shipment_ref: string;
  carrier: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  needs_test: boolean;
  assigned_tech_name: string | null;
  received_at: string | null;
  source: 'LEGACY';
}

type FBAShipmentRow = FBAShipmentLifecycleRow | FBAShipmentLegacyRow;

async function fetchFbaShipments(): Promise<{ rows: FBAShipmentRow[]; source: string }> {
  const res = await fetch('/api/dashboard/fba-shipments?limit=500');
  if (!res.ok) throw new Error('Failed to fetch FBA shipments');
  const data = await res.json();
  return { rows: Array.isArray(data?.rows) ? data.rows : [], source: data?.source || 'unknown' };
}

const STATUS_STYLES: Record<string, string> = {
  PLANNED:        'bg-gray-100 text-gray-600 border-gray-200',
  READY_TO_GO:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  LABEL_ASSIGNED: 'bg-blue-100 text-blue-700 border-blue-200',
  SHIPPED:        'bg-purple-100 text-purple-700 border-purple-200',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || 'bg-gray-100 text-gray-500 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase tracking-widest ${cls}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ReadinessBar({ ready, total }: { ready: number; total: number }) {
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden w-16">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-bold text-gray-500 tabular-nums">{ready}/{total}</span>
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
      const itemsRes = await fetch(`/api/fba/shipments/${row.id}/items`, { cache: 'no-store' });
      const data = await itemsRes.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length !== 1 || String(items[0].status) !== 'PLANNED') return;
      const del = await fetch(`/api/fba/shipments/${row.id}/items/${items[0].id}`, {
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
        <span className="text-gray-500">/{row.total_expected_qty}</span>
      </span>
      {canRemove ? (
        <button
          type="button"
          onClick={() => void removeSinglePlannedItem()}
          disabled={busy}
          title="Remove the only line from this plan"
          aria-label="Remove item from plan"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Minus className="h-3 w-3" />}
        </button>
      ) : null}
    </div>
  );
}

function enumLabel(value: string | null | undefined) {
  return String(value || '').replaceAll('_', ' ') || '-';
}

export default function FBAShipmentsTable() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-fba-shipments'],
    queryFn: fetchFbaShipments,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const rows = data?.rows ?? [];
  const source = data?.source ?? 'unknown';
  const isLegacy = source === 'legacy';

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <p className="text-sm font-black uppercase tracking-widest text-red-600">Failed to load FBA shipments</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-gray-200 bg-purple-50 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-black uppercase tracking-tight text-purple-900">FBA Shipments</h2>
            <p className={`mt-1 ${sectionLabel} text-purple-500`}>
              {isLegacy ? 'Receiving Queue (legacy)' : 'Shipment Lifecycle Board'} — {rows.length} shipments
            </p>
          </div>
          {isLegacy && (
            <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg">
              Run migration to enable lifecycle view
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">No FBA shipments</p>
          </div>
        ) : isLegacy ? (
          /* ── Legacy table (pre-migration) ── */
          <table className="min-w-full border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
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
                <tr key={row.id} className="border-b border-gray-100 text-[11px] font-bold text-gray-700 hover:bg-gray-50">
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
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-gray-200 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">
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
                  <tr key={row.id} className="border-b border-gray-100 text-[11px] font-bold text-gray-700 hover:bg-purple-50 transition-colors">
                    <td className="px-3 py-2">
                      <span className="font-mono text-purple-700 font-black">{row.shipment_ref}</span>
                      {row.notes && (
                        <p className="text-[9px] text-gray-500 font-normal truncate max-w-[140px]">{row.notes}</p>
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
                    <td className="px-3 py-2 font-mono text-gray-500">{row.destination_fc || '-'}</td>
                    <td className="px-3 py-2">{row.due_date ? new Date(row.due_date).toLocaleDateString() : '-'}</td>
                    <td className="px-3 py-2">{row.assigned_tech_name || '-'}</td>
                    <td className="px-3 py-2">{row.assigned_packer_name || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{formatDateTimePST(row.created_at)}</td>
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
