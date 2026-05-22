'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Search } from '@/components/Icons';
import { TriagePile } from './TriagePile';
import { TriageEmailRow } from './TriageEmailRow';
import { useTriageDragAndDrop } from './useTriageDragAndDrop';
import {
  TRIAGE_PILES,
  emptyPiles,
  type TriagePile as TriagePileId,
  type TriagePiles,
  type TriageResponse,
  type TriageRow,
} from './types';

interface PoTriagePanelProps {
  /** Overrides the default behavior of navigating to ?msg=<id>. */
  onRowClick?: (row: TriageRow) => void;
}

const DEFAULT_EXPANDED: Record<TriagePileId, boolean> = {
  inbox:  true,
  upload: true,
  ignore: false,
  done:   false,
};

export function PoTriagePanel({ onRowClick }: PoTriagePanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('msg');

  const [piles, setPiles] = useState<TriagePiles>(() => emptyPiles());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<TriagePileId, boolean>>(DEFAULT_EXPANDED);
  const [scanQuery, setScanQuery] = useState('is:unread');
  const [scanLoading, setScanLoading] = useState(false);

  const dnd = useTriageDragAndDrop({ piles, setPiles });

  // Default row-click behavior: navigate the po-mailbox page to ?msg=<id>.
  // Stays on whatever page the sidebar is currently rendered into, so the
  // sidebar keeps its position while the main content swaps to the detail view.
  const handleRowClick = useCallback(
    (row: TriageRow) => {
      if (onRowClick) {
        onRowClick(row);
        return;
      }
      const targetPath = pathname?.startsWith('/inventory/po-mailbox')
        ? pathname
        : '/inventory/po-mailbox';
      router.push(`${targetPath}?msg=${encodeURIComponent(row.id)}`);
    },
    [onRowClick, pathname, router],
  );

  const loadPiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/po-gmail/triage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as TriageResponse;
      setPiles(data.piles);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load piles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPiles();
  }, [loadPiles]);

  const runReconcile = useCallback(async () => {
    setScanLoading(true);
    try {
      const url = new URL('/api/admin/po-gmail/reconcile', window.location.origin);
      url.searchParams.set('q', scanQuery);
      url.searchParams.set('limit', '25');
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as {
        counts: { missing: number; in_zoho: number; received: number };
        elapsedMs: number;
      };
      toast.success(
        `Scanned · missing ${data.counts.missing}, in Zoho ${data.counts.in_zoho}, received ${data.counts.received} (${data.elapsedMs}ms)`,
      );
      await loadPiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  }, [scanQuery, loadPiles]);

  const toggleExpanded = useCallback((pile: TriagePileId) => {
    setExpanded((prev) => ({ ...prev, [pile]: !prev[pile] }));
  }, []);

  return (
    <div className="space-y-2.5">
      {/* Scan controls */}
      <div className="space-y-1.5 rounded-md border border-gray-200 bg-white p-2">
        <label className="block">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Gmail query
          </span>
          <input
            type="text"
            value={scanQuery}
            onChange={(e) => setScanQuery(e.target.value)}
            placeholder="is:unread"
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-[12px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={runReconcile}
            disabled={scanLoading}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 py-1 text-[11.5px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {scanLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Scan + reconcile
          </button>
          <button
            type="button"
            onClick={loadPiles}
            disabled={loading}
            className="rounded-md border border-gray-200 p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh piles"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Pile stack */}
      <DndContext
        sensors={dnd.sensors}
        onDragStart={dnd.handleDragStart}
        onDragEnd={dnd.handleDragEnd}
        onDragCancel={dnd.handleDragCancel}
      >
        <div className="space-y-1.5">
          {TRIAGE_PILES.map((pile) => (
            <TriagePile
              key={pile}
              pile={pile}
              bucket={piles[pile]}
              expanded={expanded[pile]}
              onToggleExpanded={toggleExpanded}
              onRowClick={handleRowClick}
              selectedRowId={selectedId}
              draggingRowId={dnd.activeRow?.id ?? null}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {dnd.activeRow ? (
            <TriageEmailRow row={dnd.activeRow} pile={dnd.activeRow.pile} compact />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
