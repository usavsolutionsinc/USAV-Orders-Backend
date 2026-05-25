'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import { RepairActionTimeline } from '@/components/repair/mobile/RepairActionTimeline';
import { AddRepairActionSheet } from '@/components/repair/mobile/AddRepairActionSheet';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { useActivityInboxOptional } from '@/contexts/ActivityInboxContext';

const STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Done',
];

const STATUS_TONE: Record<string, string> = {
  'Awaiting Parts':              'bg-amber-100 text-amber-800 border-amber-200',
  'Pending Repair':              'bg-blue-100 text-blue-700 border-blue-200',
  'Awaiting Pickup':             'bg-amber-100 text-amber-800 border-amber-200',
  'Repaired, Contact Customer':  'bg-violet-100 text-violet-700 border-violet-200',
  'Awaiting Payment':            'bg-amber-100 text-amber-800 border-amber-200',
  'Done':                        'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function firstNameOf(contactInfo: string | null | undefined): string {
  const raw = (contactInfo || '').split(',')[0]?.trim() || '';
  return raw.split(/\s+/)[0] || 'Customer';
}

function daysSince(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day in shop';
  return `${d} days in shop`;
}

function RepairMobilePageInner() {
  const params = useParams<{ id: string }>();
  const repairId = Number(params?.id);
  const inbox = useActivityInboxOptional();

  const [repair, setRepair] = useState<RSRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAddSheet, setShowAddSheet] = useState(false);

  const loadRepair = useCallback(async () => {
    if (!Number.isFinite(repairId) || repairId <= 0) {
      setError('Invalid repair id');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/repair-service/${repairId}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as RSRecord;
      setRepair(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repair');
    } finally {
      setLoading(false);
    }
  }, [repairId]);

  useEffect(() => {
    void loadRepair();
  }, [loadRepair]);

  const handleStatusChange = useCallback(
    async (next: string) => {
      if (!repair || updatingStatus) return;
      const previous = repair.status ?? '';
      if (previous === next) return;
      setUpdatingStatus(next);
      setRepair({ ...repair, status: next });
      try {
        const res = await fetch('/api/repair-service', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: repair.id, status: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        inbox?.pushRepairStatusChange({
          repairId: repair.id,
          previousStatus: previous,
          nextStatus: next,
        });
      } catch (err) {
        setRepair({ ...repair, status: previous });
        setError(err instanceof Error ? err.message : 'Status update failed');
      } finally {
        setUpdatingStatus(null);
      }
    },
    [repair, updatingStatus, inbox],
  );

  const customerFirstName = useMemo(() => firstNameOf(repair?.contact_info), [repair?.contact_info]);
  const rsCode = `RS-${repairId}`;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-500">
              Repair
            </p>
            <h1 className="truncate text-lg font-black text-slate-900">{rsCode}</h1>
            {repair && (
              <p className="mt-0.5 truncate text-caption font-bold text-slate-600">
                {customerFirstName} · {repair.product_title || 'Bose Repair'}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <NetworkChip compact />
            {repair?.status && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                  STATUS_TONE[repair.status] || 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {repair.status}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Status pill bar — horizontal scroll */}
      <div className="sticky top-[68px] z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-3 py-2 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {STATUS_OPTIONS.map((status) => {
            const active = repair?.status === status;
            const pending = updatingStatus === status;
            const tone = active
              ? STATUS_TONE[status] || 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-300';
            return (
              <button
                key={status}
                type="button"
                onClick={() => handleStatusChange(status)}
                disabled={!repair || !!updatingStatus}
                className={`shrink-0 rounded-full border px-3.5 py-2 text-caption font-black uppercase tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${tone}`}
              >
                {pending ? 'Saving…' : status}
              </button>
            );
          })}
        </div>
      </div>

      <main className="flex-1 px-4 py-3 space-y-3">
        {loading && (
          <p className="text-center text-sm font-semibold text-slate-500 py-10">Loading…</p>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {!loading && repair && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <Row label="Issue" value={repair.issue || '—'} />
              <Row
                label="Serial"
                value={
                  repair.serial_number ? (
                    <span className="font-mono">{repair.serial_number}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )
                }
              />
              {repair.source_sku && (
                <Row
                  label="Source SKU"
                  value={<span className="font-mono">{repair.source_sku}</span>}
                />
              )}
              <Row
                label="Price"
                value={
                  <span className="text-emerald-600 font-black">
                    ${repair.price || '0'}
                  </span>
                }
              />
              <Row
                label="Intake"
                value={
                  repair.created_at
                    ? new Date(repair.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: '2-digit',
                      })
                    : '—'
                }
                hint={daysSince(repair.created_at)}
              />
              {repair.notes && (
                <Row label="Customer notes" value={repair.notes} />
              )}
            </section>

            <RepairActionTimeline
              repairId={repairId}
              refreshKey={refreshKey}
            />
          </>
        )}
      </main>

      {repair && (
        <button
          type="button"
          onClick={() => setShowAddSheet(true)}
          className="fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-orange-500 text-white text-2xl font-black shadow-lg shadow-orange-500/40 active:scale-95 transition-transform"
          aria-label="Add repair action"
        >
          +
        </button>
      )}

      {showAddSheet && repair && (
        <AddRepairActionSheet
          repairId={repairId}
          onClose={() => setShowAddSheet(false)}
          onSaved={() => {
            setShowAddSheet(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-slate-100 last:border-b-0">
      <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 shrink-0">
        {label}
      </span>
      <div className="text-right min-w-0">
        <p className="text-sm font-bold text-slate-900 break-words">{value}</p>
        {hint ? (
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

export default function RepairMobilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <RepairMobilePageInner />
    </Suspense>
  );
}
