'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, MapPin, Loader2, Edit, Package } from '@/components/Icons';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BinLocation {
  id: number;
  name: string;
  room: string | null;
  rowLabel: string | null;
  colLabel: string | null;
  barcode: string | null;
  binType: string | null;
  capacity: number | null;
}

export interface BinContentRow {
  id: number;
  sku: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  lastCounted: string | null;
  productTitle: string | null;
}

interface BinContentsViewProps {
  barcode: string;
  onBack: () => void;
  /** Called when the user taps a SKU row → parent opens SkuDetailView panel. */
  onOpenSku: (sku: string) => void;
  /** Called when the user taps the qty edit button → parent opens QtyEditBottomSheet. */
  onEditQty: (row: BinContentRow, location: BinLocation) => void;
  /** Notify parent that bin data loaded (used to record recent scan label). */
  onLoaded?: (location: BinLocation, contents: BinContentRow[]) => void;
  /** Refresh trigger — incrementing this re-fetches the bin. */
  refreshKey?: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BinContentsView({
  barcode,
  onBack,
  onOpenSku,
  onEditQty,
  onLoaded,
  refreshKey = 0,
}: BinContentsViewProps) {
  const [location, setLocation] = useState<BinLocation | null>(null);
  const [contents, setContents] = useState<BinContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(barcode)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load bin');
      const loc = json.location as BinLocation;
      const rows = (json.contents ?? []) as BinContentRow[];
      setLocation(loc);
      setContents(rows);
      onLoaded?.(loc, rows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load bin');
      setLocation(null);
      setContents([]);
    } finally {
      setLoading(false);
    }
  }, [barcode, onLoaded]);

  useEffect(() => {
    void fetchBin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode, refreshKey]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex h-full flex-col bg-white">
        <Header onBack={onBack} title={barcode} subtitle="Loading bin…" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  // ── Error / not found ──
  if (error || !location) {
    return (
      <div className="flex h-full flex-col bg-white">
        <Header onBack={onBack} title={barcode} subtitle="Bin not found" />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <Package className="h-6 w-6 text-red-400" />
          </div>
          <p className="mb-1 text-sm font-black text-gray-800">Bin not found</p>
          <p className="text-[11px] font-bold text-gray-500">{error || `No bin matches "${barcode}".`}</p>
        </div>
      </div>
    );
  }

  // ── Loaded ──
  const address =
    location.rowLabel && location.colLabel
      ? `Row ${location.rowLabel} · Col ${location.colLabel}`
      : location.name;

  return (
    <div className="flex h-full flex-col bg-white">
      <Header
        onBack={onBack}
        title={location.room || location.name}
        subtitle={address}
      />

      {/* Bin meta */}
      <div className="border-b border-gray-200 bg-gray-50/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-orange-500" />
          <span className="text-[10px] font-black font-mono uppercase tracking-wider text-orange-600">
            {location.barcode}
          </span>
          {location.capacity != null && (
            <span className="ml-auto text-[9px] font-black uppercase tracking-wider text-gray-400">
              Cap {location.capacity}
            </span>
          )}
        </div>
      </div>

      {/* Contents list */}
      <div className="flex-1 overflow-y-auto">
        {contents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
              <Package className="h-6 w-6 text-gray-400" />
            </div>
            <p className="mb-1 text-sm font-black text-gray-700">Empty bin</p>
            <p className="text-[11px] font-bold text-gray-400">No SKUs stored here yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            <li className="sticky top-0 z-10 flex items-center justify-between bg-white/95 px-5 py-2 backdrop-blur">
              <span className={sectionLabel}>{contents.length} SKU{contents.length !== 1 ? 's' : ''}</span>
              <span className={fieldLabel}>Qty</span>
            </li>
            {contents.map((row) => (
              <li key={row.id}>
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => onOpenSku(row.sku)}
                    className="flex flex-1 items-center gap-3 px-5 py-3 text-left transition-colors active:bg-blue-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-black font-mono text-gray-900">
                        {row.sku}
                      </p>
                      {row.productTitle && (
                        <p className="mt-0.5 truncate text-[10px] font-bold text-gray-500">
                          {row.productTitle}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[15px] font-black tabular-nums text-gray-900">
                        {row.qty}
                      </span>
                      {(row.minQty != null || row.maxQty != null) && (
                        <span className="text-[9px] font-bold text-gray-400">
                          {row.minQty ?? '—'} / {row.maxQty ?? '—'}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditQty(row, location)}
                    aria-label={`Edit quantity for ${row.sku}`}
                    className="flex-shrink-0 flex w-12 items-center justify-center border-l border-gray-100 text-gray-400 transition-colors active:bg-gray-100 active:text-blue-600"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Header subcomponent ────────────────────────────────────────────────────

function Header({
  onBack,
  title,
  subtitle,
}: {
  onBack: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors active:bg-gray-100"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-black uppercase tracking-wider text-gray-900">
          {title}
        </p>
        <p className="truncate text-[9px] font-bold uppercase tracking-widest text-gray-400">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

