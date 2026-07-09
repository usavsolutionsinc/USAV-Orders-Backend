'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Package, Search, X } from '../../Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';

interface PoListRow {
  po_id: string;
  po_number: string;
  receiving_id: number | null;
}

interface MovePhotoToPoPanelProps {
  open: boolean;
  currentReceivingId?: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (receivingId: number) => void;
}

/**
 * In-viewer PO picker — search open POs and move the current photo to another
 * carton. Rendered inside the dark lightbox so it inherits the modal z-stack.
 */
export function MovePhotoToPoPanel({
  open,
  currentReceivingId,
  busy = false,
  error,
  onClose,
  onSelect,
}: MovePhotoToPoPanelProps) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PoListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setRows([]);
      setFetchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams({ view: 'open', limit: '25' });
        const q = search.trim();
        if (q) params.set('search', q);
        const res = await fetch(`/api/receiving/po/list?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { purchase_orders?: PoListRow[] };
        const list = (data.purchase_orders ?? []).filter(
          (row) => row.receiving_id != null && row.receiving_id !== currentReceivingId,
        );
        setRows(list);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setFetchError(err instanceof Error ? err.message : 'Search failed');
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, search.trim() ? 280 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, search, currentReceivingId]);

  if (!open) return null;

  return (
    <motion.div
      data-testid="move-photo-po-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="absolute inset-x-0 top-24 z-30 mx-auto w-full max-w-md px-6"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="overflow-hidden rounded-2xl border border-glass/20 bg-scrim/80 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass/10 px-4 py-3">
          <div className="flex items-center gap-2 text-white">
            <Package className="h-4 w-4 text-blue-300" />
            <span className="text-sm font-bold">Move photo to PO</span>
          </div>
          <HoverTooltip label="Close" asChild>
            <IconButton
              onClick={onClose}
              disabled={busy}
              className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-glass/10 hover:text-white"
              ariaLabel="Close move panel"
              icon={<X className="h-4 w-4" />}
            />
          </HoverTooltip>
        </div>

        <div className="border-b border-glass/10 px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-glass/15 bg-glass/5 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-white/50" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PO number…"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
              autoFocus
              disabled={busy}
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto divide-y divide-glass/10">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : fetchError ? (
            <p className="px-4 py-6 text-center text-sm text-rose-300">{fetchError}</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-white/50">No matching open POs</p>
          ) : (
            rows.map((row) => (
              <button
                // ds-raw-button
                key={`${row.po_id}-${row.receiving_id}`}
                type="button"
                disabled={busy || row.receiving_id == null}
                onClick={() => row.receiving_id != null && onSelect(row.receiving_id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-glass/10 disabled:opacity-50"
              >
                <div>
                  <p className="text-sm font-bold text-white">
                    {row.po_number || row.po_id || `PO #${row.receiving_id}`}
                  </p>
                  <p className="text-xs text-white/50">Carton #{row.receiving_id}</p>
                </div>
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-white/60" /> : null}
              </button>
            ))
          )}
        </div>

        {error ? (
          <p className="border-t border-glass/10 px-4 py-2 text-center text-xs font-semibold text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}
