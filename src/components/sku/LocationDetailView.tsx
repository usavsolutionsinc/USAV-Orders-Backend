'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from '@/components/Icons';
import { BinAddSkuSheet } from '@/components/sku/BinAddSkuSheet';
import { BinStockNumpadSheet } from '@/components/sku/BinStockNumpadSheet';
import { BinRowDetailsSheet } from '@/components/sku/BinRowDetailsSheet';
import { BinCycleCountSheet } from '@/components/sku/BinCycleCountSheet';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStationChannelName } from '@/lib/realtime/channels';

// ─── Types ──────────────────────────────────────────────────────────────────

interface BinLocation {
  id: number;
  name: string;
  room: string | null;
  rowLabel: string | null;
  colLabel: string | null;
  barcode: string | null;
  binType: string | null;
  capacity: number | null;
}

interface BinContentRow {
  id: number;
  sku: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  lastCounted: string | null;
  productTitle: string | null;
  displayNameOverride?: string | null;
  /** Version token used for optimistic concurrency on the `set` action. */
  updatedAt?: string | null;
}

interface LocationPayload {
  location: BinLocation;
  contents: BinContentRow[];
}

interface LocationDetailViewProps {
  barcode: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'Recently';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Bin detail view — shown when a user scans a bin QR or navigates to
 * /sku-stock/location/[barcode]. Renders the bin metadata + contents.
 * Phase 2 is read-only; Phase 3 swaps each row to <BinSkuEditorRow />.
 */
export function LocationDetailView({ barcode }: LocationDetailViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [numpadRow, setNumpadRow] = useState<BinContentRow | null>(null);
  const [detailsRow, setDetailsRow] = useState<BinContentRow | null>(null);
  const [cycleSheetOpen, setCycleSheetOpen] = useState(false);
  const queryKey = useMemo(() => ['bin-contents', barcode] as const, [barcode]);

  // Detect whether any open cycle-count campaign has lines for this bin. A
  // tiny extra query — runs once after the bin loads, gets invalidated on
  // submit so the banner clears the moment the last line lands.
  const cycleQueryKey = useMemo(
    () => ['bin-active-cycle-count', barcode] as const,
    [barcode],
  );

  const { data, isLoading, error, refetch } = useQuery<LocationPayload>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/locations/${encodeURIComponent(barcode)}`, {
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return body as LocationPayload;
    },
    enabled: barcode.length > 0,
    staleTime: 10_000,
  });

  const binId = data?.location?.id ?? null;

  // Active cycle-count detection — only fires once we know the bin id.
  const activeCampaign = useQuery<{
    id: number;
    name: string;
    pending: number;
    review: number;
  } | null>({
    queryKey: cycleQueryKey,
    enabled: binId != null,
    staleTime: 30_000,
    queryFn: async () => {
      if (!binId) return null;
      // Reuse the campaigns list — server already filters by status; we
      // pick the most recent open one that has lines for this bin.
      const res = await fetch(`/api/cycle-counts/campaigns?status=open`, {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const payload = await res.json();
      const campaigns: Array<{
        id: number;
        name: string;
        pending_lines: number;
        review_lines: number;
      }> = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
      // For each open campaign, ask whether any line targets this bin.
      // Bounded fan-out — usually 1–2 open campaigns at a time.
      for (const c of campaigns) {
        const detail = await fetch(
          `/api/cycle-counts/campaigns/${c.id}?bin_id=${binId}`,
          { cache: 'no-store' },
        );
        if (!detail.ok) continue;
        const dd = await detail.json();
        const linesForBin: Array<{ status: string }> = Array.isArray(dd?.lines)
          ? dd.lines
          : [];
        const pending = linesForBin.filter((l) => l.status === 'pending').length;
        const review = linesForBin.filter((l) => l.status === 'pending_review').length;
        if (pending + review > 0) {
          return { id: c.id, name: c.name, pending, review };
        }
      }
      return null;
    },
  });

  const handleSkuClick = useCallback(
    (sku: string) => {
      const next = sku.trim();
      if (!next) return;
      router.push(`/sku-stock?sku=${encodeURIComponent(next)}`);
    },
    [router],
  );

  // Realtime: refetch when any STOCK_DELTA fires for a SKU currently in this
  // bin (another tab, another staff, etc.). Publishers carry the SKU on
  // scanRef — see publishStockLedgerEvent in src/lib/realtime/publish.ts.
  // useAblyChannel's handler is wrapped in a stable ref internally so passing
  // a fresh callback on every data change is cheap and avoids re-subscribe.
  useAblyChannel(
    getStationChannelName(),
    'activity.logged',
    (msg: {
      data?: { activityType?: string; scanRef?: string | null };
    }) => {
      const type = String(msg?.data?.activityType || '');
      if (!type.startsWith('STOCK_DELTA_')) return;
      const sku = String(msg?.data?.scanRef || '').trim().toUpperCase();
      if (!sku) return;
      const contents = data?.contents ?? [];
      const hit = contents.some((c) => (c.sku || '').toUpperCase() === sku);
      if (hit) queryClient.invalidateQueries({ queryKey });
    },
    barcode.length > 0,
  );

  if (!barcode) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 px-6 text-center">
        <p className="text-sm font-semibold text-gray-500">Missing bin barcode.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-gray-600">Loading bin…</p>
        </div>
      </div>
    );
  }

  if (error || !data?.location) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
        <p className="text-sm font-semibold text-rose-600">
          {error instanceof Error ? error.message : `Bin "${barcode}" not found.`}
        </p>
        <button
          type="button"
          onClick={() => router.push('/sku-stock?view=location')}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
        >
          ← Back to scan
        </button>
      </div>
    );
  }

  const { location, contents } = data;
  const subtitle =
    location.rowLabel && location.colLabel
      ? `Row ${location.rowLabel} · Col ${location.colLabel}`
      : location.room || '';
  const totalQty = contents.reduce((sum, r) => sum + (r.qty || 0), 0);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Bin
            </p>
            <h1 className="truncate text-lg font-black text-slate-900">
              {location.name}
            </h1>
            {subtitle && (
              <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-600">
                {subtitle}
              </p>
            )}
            {location.barcode && (
              <p className="mt-0.5 truncate font-mono text-[11px] font-bold text-slate-500">
                {location.barcode}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {location.capacity != null && (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                Cap {location.capacity}
              </span>
            )}
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              {totalQty} on hand
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 active:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 py-3 pb-24">
        {activeCampaign.data && (
          <button
            type="button"
            onClick={() => setCycleSheetOpen(true)}
            className="mb-3 flex w-full items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left active:bg-blue-100"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">
                Cycle count active
              </p>
              <p className="mt-0.5 truncate text-sm font-bold text-blue-900">
                {activeCampaign.data.name}
              </p>
              <p className="text-[11px] font-bold text-blue-700">
                {activeCampaign.data.pending} pending
                {activeCampaign.data.review > 0
                  ? ` · ${activeCampaign.data.review} in review`
                  : ''}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              Start count
            </span>
          </button>
        )}

        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Contents ({contents.length})
          </p>
          <button
            type="button"
            onClick={() => setAddSheetOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white active:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add product
          </button>
        </div>
        {contents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
            Empty bin
          </div>
        ) : (
          <ul className="space-y-2">
            {contents.map((row) => {
              const lowStock = row.minQty != null && row.qty <= row.minQty;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setNumpadRow(row)}
                    className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-black text-slate-900">
                        {row.sku}
                      </p>
                      {row.productTitle && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
                          {row.productTitle}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Counted {formatAgo(row.lastCounted)} ago
                        {row.minQty != null && row.maxQty != null
                          ? ` · ${row.minQty}–${row.maxQty}`
                          : ''}
                        {lowStock ? ' · LOW' : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-black tabular-nums text-slate-900">
                        {row.qty}
                      </p>
                      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                        tap to edit
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <BinAddSkuSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        binBarcode={barcode}
        invalidateKey={queryKey}
      />

      {activeCampaign.data && binId != null && (
        <BinCycleCountSheet
          open={cycleSheetOpen}
          onClose={() => {
            setCycleSheetOpen(false);
            // Refresh the banner counter when the sheet closes.
            queryClient.invalidateQueries({ queryKey: cycleQueryKey });
          }}
          binId={binId}
          campaignId={activeCampaign.data.id}
          campaignName={activeCampaign.data.name}
          invalidateKey={queryKey}
        />
      )}

      <BinStockNumpadSheet
        open={numpadRow != null}
        onClose={() => setNumpadRow(null)}
        binBarcode={barcode}
        row={numpadRow}
        invalidateKey={queryKey}
        onOpenDetails={() => {
          // Hop from the numpad to the details screen; carry the row across.
          if (numpadRow) {
            setDetailsRow(numpadRow);
            setNumpadRow(null);
          }
        }}
      />

      <BinRowDetailsSheet
        open={detailsRow != null}
        onClose={() => setDetailsRow(null)}
        binBarcode={barcode}
        row={
          detailsRow
            ? {
                sku: detailsRow.sku,
                qty: detailsRow.qty,
                productTitle: detailsRow.productTitle,
                displayNameOverride: detailsRow.displayNameOverride ?? null,
                minQty: detailsRow.minQty,
                maxQty: detailsRow.maxQty,
                updatedAt: detailsRow.updatedAt ?? null,
              }
            : null
        }
        invalidateKey={queryKey}
      />
    </div>
  );
}
