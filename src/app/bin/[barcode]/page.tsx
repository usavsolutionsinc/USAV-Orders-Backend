'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AuditTimeline } from '@/components/audit/AuditTimeline';
import { Button } from '@/design-system/primitives';

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
}

interface BinPayload {
  location: BinLocation;
  contents: BinContentRow[];
}

// ─── Page ───────────────────────────────────────────────────────────────────

function BinPageInner() {
  const router = useRouter();
  const params = useParams<{ barcode: string }>();
  const barcode = decodeURIComponent(params?.barcode || '').trim();
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

  const [bin, setBin] = useState<BinPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!barcode) {
      setError('Missing bin barcode');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(barcode)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBin({ location: data.location, contents: data.contents ?? [] });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bin');
    } finally {
      setLoading(false);
    }
  }, [barcode]);

  useEffect(() => {
    load();
  }, [load]);

  const subtitle =
    bin?.location.rowLabel && bin?.location.colLabel
      ? `Row ${bin.location.rowLabel} · Col ${bin.location.colLabel}`
      : bin?.location.room ?? '';

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col">
      <header className="sticky top-0 z-10 bg-surface-card border-b border-border-soft px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-micro font-black uppercase tracking-[0.16em] text-text-soft">
              Bin
            </p>
            <h1 className="truncate text-lg font-black text-text-default">
              {bin?.location.name || barcode}
            </h1>
            {subtitle && (
              <p className="mt-0.5 truncate text-caption font-semibold text-text-muted">
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {bin?.location.capacity != null && (
              <span className="inline-flex items-center rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-bold text-text-muted">
                Cap {bin.location.capacity}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={load}>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-3 space-y-3 pb-24">
        {loading && (
          <p className="text-center text-sm font-semibold text-text-soft py-10">
            Loading…
          </p>
        )}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {!loading && bin && (
          <>
            <section>
              <p className="px-1 mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
                Contents ({bin.contents.length})
              </p>
              {bin.contents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border-default bg-surface-card p-4 text-center text-sm font-semibold text-text-soft">
                  Empty bin
                </p>
              ) : (
                <ul className="space-y-2">
                  {bin.contents.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() =>
                          router.push(`/inventory?sku=${encodeURIComponent(row.sku)}`)
                        }
                        className="ds-raw-button block w-full text-left rounded-lg border border-border-soft bg-surface-card px-4 py-3 shadow-sm active:bg-surface-hover"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-sm font-black text-text-default truncate">
                              {row.sku}
                            </p>
                            {row.productTitle && (
                              <p className="mt-1 text-caption text-text-soft line-clamp-2 leading-snug">
                                {row.productTitle}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-base font-black tabular-nums text-text-default">
                              {row.qty}
                            </p>
                            {row.minQty != null && row.maxQty != null && (
                              <p className="text-micro font-bold text-text-soft">
                                {row.minQty}–{row.maxQty}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {bin && (
              <AuditTimeline binId={bin.location.id} limit={50} compact />
            )}
          </>
        )}
      </main>

      <footer className="sticky bottom-0 bg-surface-card border-t border-border-soft px-4 py-3 text-caption font-semibold text-text-soft text-center">
        Staff #{staffId}
      </footer>
    </div>
  );
}

export default function BinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-canvas" />}>
      <BinPageInner />
    </Suspense>
  );
}
