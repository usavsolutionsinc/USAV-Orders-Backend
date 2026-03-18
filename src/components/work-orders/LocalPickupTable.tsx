'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, RefreshCw } from '@/components/Icons';
import { StatusBadge } from '@/design-system';

type LocalPickupRow = {
  receiving_id: number;
  pickup_date: string;
  product_title: string | null;
  sku: string | null;
  quantity: number;
  parts_status: string;
  missing_parts_note: string | null;
  receiving_grade: string | null;
  condition_note: string | null;
  offer_price: string | null;
  total: string | null;
  tracking_number: string | null;
  carrier: string | null;
  received_at: string | null;
  work_order_status: string | null;
};

type LocalPickupResponse = {
  success: boolean;
  pickup_date: string;
  rows: LocalPickupRow[];
  summary: {
    item_count: number;
    total_value: string;
    missing_parts_count: number;
  };
};

type EditablePickupRow = {
  partsStatus: 'COMPLETE' | 'MISSING_PARTS';
  missingPartsNote: string;
  receivingGrade: string;
  conditionNote: string;
  offerPrice: string;
  total: string;
};

const GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'PARTS_ONLY'];

function toMoneyDisplay(value: string | null) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : '$0.00';
}

function formatPickupDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTimestamp(value: string | null) {
  if (!value) return 'No intake stamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function LocalPickupTable() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const search = searchParams.get('q') || '';
  const pickupDate = searchParams.get('pickupDate') || '';
  const [drafts, setDrafts] = useState<Record<number, EditablePickupRow>>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  const queryKey = ['local-pickups', pickupDate, search];
  const { data, isLoading, isFetching, refetch } = useQuery<LocalPickupResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (pickupDate) params.set('pickupDate', pickupDate);
      if (search.trim()) params.set('q', search.trim());
      const res = await fetch(`/api/local-pickups?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch local pickups');
      return res.json();
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!data?.rows) return;
    setDrafts(
      Object.fromEntries(
        data.rows.map((row) => [
          row.receiving_id,
          {
            partsStatus: row.parts_status === 'MISSING_PARTS' ? 'MISSING_PARTS' : 'COMPLETE',
            missingPartsNote: row.missing_parts_note || '',
            receivingGrade: row.receiving_grade || '',
            conditionNote: row.condition_note || '',
            offerPrice: row.offer_price || '',
            total: row.total || '',
          },
        ])
      )
    );
  }, [data?.rows]);

  const selectedDateLabel = useMemo(
    () => formatPickupDate(data?.pickup_date || pickupDate || new Date().toISOString().slice(0, 10)),
    [data?.pickup_date, pickupDate]
  );

  const updateDraft = (receivingId: number, patch: Partial<EditablePickupRow>) => {
    setDrafts((current) => ({
      ...current,
      [receivingId]: {
        ...(current[receivingId] || {
          partsStatus: 'COMPLETE',
          missingPartsNote: '',
          receivingGrade: '',
          conditionNote: '',
          offerPrice: '',
          total: '',
        }),
        ...patch,
      },
    }));
  };

  const saveRow = async (row: LocalPickupRow) => {
    const draft = drafts[row.receiving_id];
    if (!draft) return;
    setSavingId(row.receiving_id);
    try {
      const res = await fetch('/api/local-pickups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId: row.receiving_id,
          pickupDate: data?.pickup_date || row.pickup_date,
          productTitle: row.product_title,
          sku: row.sku,
          quantity: row.quantity,
          partsStatus: draft.partsStatus,
          missingPartsNote: draft.partsStatus === 'MISSING_PARTS' ? draft.missingPartsNote : '',
          receivingGrade: draft.receivingGrade,
          conditionNote: draft.conditionNote,
          offerPrice: draft.offerPrice,
          total: draft.total,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to save local pickup row');
      }
      await queryClient.invalidateQueries({ queryKey: ['local-pickups'] });
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (error: any) {
      window.alert(error?.message || 'Failed to save local pickup row');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      <div className="border-b border-[var(--color-neutral-200)] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-700)]">
              Local Pickups
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-neutral-900)]">
              {selectedDateLabel}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-neutral-700)]">
              {data?.summary.item_count ?? 0} items · {toMoneyDisplay(data?.summary.total_value || '0')}
              {data?.summary.missing_parts_count ? ` · ${data.summary.missing_parts_count} missing parts` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 border-b border-[var(--color-neutral-900)] py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-900)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(240px,2fr)_80px_160px_110px_minmax(180px,1.2fr)_120px_120px_90px] border-b border-[var(--color-neutral-200)] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">
        <div>Product</div>
        <div>Qty</div>
        <div>Parts</div>
        <div>Grade</div>
        <div>Condition Note</div>
        <div>Offer</div>
        <div>Total</div>
        <div>Save</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : !data?.rows?.length ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-sm font-medium italic text-gray-400 opacity-60">
              No local pickups found for this date
            </p>
          </div>
        ) : (
          data.rows.map((row) => {
            const draft = drafts[row.receiving_id] || {
              partsStatus: 'COMPLETE',
              missingPartsNote: '',
              receivingGrade: '',
              conditionNote: '',
              offerPrice: '',
              total: '',
            };
            const isMissing = draft.partsStatus === 'MISSING_PARTS';
            return (
              <div
                key={row.receiving_id}
                className="grid grid-cols-[minmax(240px,2fr)_80px_160px_110px_minmax(180px,1.2fr)_120px_120px_90px] items-start gap-4 border-b border-[var(--color-neutral-200)] px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[var(--color-neutral-900)]">
                    {row.product_title || 'Unnamed pickup'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {row.sku ? <span className="text-[11px] font-mono text-[var(--color-brand-primary)]">{row.sku}</span> : null}
                    {row.tracking_number ? <span className="text-[11px] text-[var(--color-neutral-700)]">{row.tracking_number}</span> : null}
                    {row.work_order_status ? <StatusBadge status={row.work_order_status} className="text-[9px]" /> : null}
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--color-neutral-700)]">
                    Intake {formatTimestamp(row.received_at)}
                  </p>
                  {isMissing ? (
                    <textarea
                      value={draft.missingPartsNote}
                      onChange={(e) => updateDraft(row.receiving_id, { missingPartsNote: e.target.value })}
                      placeholder="List the missing parts here..."
                      className="mt-3 min-h-[70px] w-full border-b border-[var(--color-warning)] bg-transparent pb-2 text-[12px] text-[var(--color-neutral-900)] placeholder:text-gray-300 focus:outline-none"
                    />
                  ) : null}
                </div>

                <div className="pt-1 text-[14px] font-semibold text-[var(--color-neutral-900)]">
                  {row.quantity}
                </div>

                <div>
                  <select
                    value={draft.partsStatus}
                    onChange={(e) => updateDraft(row.receiving_id, { partsStatus: e.target.value as EditablePickupRow['partsStatus'] })}
                    className="w-full border-b border-[var(--color-neutral-200)] bg-transparent py-1 text-[12px] font-semibold text-[var(--color-neutral-900)] focus:outline-none"
                  >
                    <option value="COMPLETE">Complete</option>
                    <option value="MISSING_PARTS">Missing Parts</option>
                  </select>
                </div>

                <div>
                  <select
                    value={draft.receivingGrade}
                    onChange={(e) => updateDraft(row.receiving_id, { receivingGrade: e.target.value })}
                    className="w-full border-b border-[var(--color-neutral-200)] bg-transparent py-1 text-[12px] font-semibold text-[var(--color-neutral-900)] focus:outline-none"
                  >
                    <option value="">Unset</option>
                    {GRADE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <textarea
                    value={draft.conditionNote}
                    onChange={(e) => updateDraft(row.receiving_id, { conditionNote: e.target.value })}
                    placeholder="Condition note"
                    className="min-h-[70px] w-full border-b border-[var(--color-neutral-200)] bg-transparent pb-2 text-[12px] text-[var(--color-neutral-900)] placeholder:text-gray-300 focus:outline-none"
                  />
                </div>

                <div>
                  <input
                    value={draft.offerPrice}
                    onChange={(e) => updateDraft(row.receiving_id, { offerPrice: e.target.value })}
                    placeholder="0.00"
                    className="w-full border-b border-[var(--color-neutral-200)] bg-transparent py-1 text-[12px] font-semibold text-[var(--color-neutral-900)] focus:outline-none"
                  />
                  <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">
                    Seller offer
                  </p>
                </div>

                <div>
                  <input
                    value={draft.total}
                    onChange={(e) => updateDraft(row.receiving_id, { total: e.target.value })}
                    placeholder={row.total || '0.00'}
                    className="w-full border-b border-[var(--color-neutral-200)] bg-transparent py-1 text-[12px] font-semibold text-[var(--color-neutral-900)] focus:outline-none"
                  />
                  <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--color-neutral-700)]">
                    Running total
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => saveRow(row)}
                    disabled={savingId === row.receiving_id}
                    className="inline-flex items-center gap-2 border-b border-[var(--color-neutral-900)] py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-900)] disabled:opacity-40"
                  >
                    {savingId === row.receiving_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
