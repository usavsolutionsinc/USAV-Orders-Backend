'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from './WorkOrderAssignmentCard';
import type { WorkOrderRow } from './types';
import { sectionLabel, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';

interface StaffOption {
  id: number;
  name: string;
}

interface SkuSearchResult {
  sku_stock_id: number;
  sku: string;
  product_title: string;
  stock: string | null;
  wa_id: number | null;
  wa_status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | null;
  assigned_tech_id: number | null;
  assigned_packer_id: number | null;
  assigned_tech_name: string | null;
  assigned_packer_name: string | null;
  priority: number | null;
  deadline_at: string | null;
  wa_notes: string | null;
}

interface Props {
  technicianOptions: StaffOption[];
  packerOptions: StaffOption[];
}

type StockViewFilter = 'needs_assign' | 'assigned' | 'done' | 'all';

const STATUS_BADGE: Record<string, string> = {
  ASSIGNED:    'bg-blue-50 text-blue-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  OPEN:        'bg-gray-100 text-gray-500',
  DONE:        'bg-emerald-50 text-emerald-700',
};

const SELECTED_STOCK_STORAGE_KEY = 'stock-replenish:selected-sku-stock-id';

/** Convert a search result into the WorkOrderRow shape the assignment card expects */
function toWorkOrderRow(r: SkuSearchResult): WorkOrderRow {
  const stockLevel = r.stock != null ? Number(String(r.stock).replace(/[^0-9-]+/g, '')) : null;
  return {
    id:          `SKU_STOCK:${r.sku_stock_id}`,
    entityType:  'SKU_STOCK',
    entityId:    r.sku_stock_id,
    queueKey:    'stock_replenish',
    queueLabel:  'Stock Replenish',
    title:       r.product_title || r.sku,
    subtitle:    `SKU ${r.sku}${r.stock != null ? ` · Stock ${r.stock}` : ''}`,
    recordLabel: r.sku,
    sourcePath:  '/sku-stock',
    techId:      r.assigned_tech_id,
    techName:    r.assigned_tech_name,
    packerId:    r.assigned_packer_id,
    packerName:  r.assigned_packer_name,
    status:      r.wa_status ?? 'OPEN',
    priority:    r.priority ?? 100,
    deadlineAt:  r.deadline_at ?? null,
    notes:       r.wa_notes,
    assignedAt:  null,
    updatedAt:   null,
    stockLevel:  Number.isFinite(stockLevel) ? stockLevel : null,
  };
}

export function SkuStockAssignPanel({ technicianOptions, packerOptions }: Props) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState<SkuSearchResult[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<StockViewFilter>('needs_assign');
  const [selectedSkuId, setSelectedSkuId] = useState<number | null>(null);
  const [assigningRow, setAssigningRow] = useState<WorkOrderRow | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search — fires 280ms after typing stops
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/assignments/sku-search?q=${encodeURIComponent(trimmed)}&limit=60`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Search failed');
        setResults(Array.isArray(json?.items) ? json.items : []);
      } catch (err: any) {
        if (err.name !== 'AbortError') setError(err.message || 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);

  /**
   * Called by WorkOrderAssignmentCard on every save (auto or explicit).
   * Routes through PATCH /api/work-orders which correctly handles SKU_STOCK →
   * STOCK_REPLENISH work type and stores both tech + packer IDs.
   */
  const handleConfirm = useCallback(async (
    row: WorkOrderRow,
    { techId, packerId, deadline, status: statusOverride }: AssignmentConfirmPayload
  ) => {
    const newStatus =
      statusOverride ??
      (techId || packerId ? 'ASSIGNED' : 'OPEN');

    try {
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType:      'SKU_STOCK',
          entityId:        row.entityId,
          assignedTechId:  techId,
          assignedPackerId: packerId,
          status:          newStatus,
          priority:        row.priority,
          deadlineAt:      deadline,
          notes:           row.notes,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to save');
      }

      // Update the matching result row in-place so the button reflects new state
      const techName   = technicianOptions.find((s) => s.id === techId)?.name   ?? null;
      const packerName = packerOptions.find((s) => s.id === packerId)?.name ?? null;
      setResults((prev) =>
        prev.map((r) =>
          r.sku_stock_id === row.entityId
            ? {
                ...r,
                assigned_tech_id:    techId,
                assigned_packer_id:  packerId,
                assigned_tech_name:  techName,
                assigned_packer_name: packerName,
                wa_status:           newStatus as SkuSearchResult['wa_status'],
                deadline_at:         deadline ?? r.deadline_at,
              }
            : r
        )
      );

      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    } catch (err: any) {
      window.alert(err?.message || 'Failed to assign');
    }
  }, [technicianOptions, packerOptions]);

  /** A row is "fully assigned" only when BOTH tech and packer are set */
  const isFullyAssigned = (r: SkuSearchResult) =>
    r.assigned_tech_id != null && r.assigned_packer_id != null;

  const isDone = (r: SkuSearchResult) => r.wa_status === 'DONE';
  const needsAssignment = (r: SkuSearchResult) => !isDone(r) && !isFullyAssigned(r);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(SELECTED_STOCK_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      setSelectedSkuId(parsed);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || selectedSkuId == null) return;
    window.localStorage.setItem(SELECTED_STOCK_STORAGE_KEY, String(selectedSkuId));
  }, [selectedSkuId]);

  useEffect(() => {
    if (!results.length) return;
    if (selectedSkuId != null && results.some((r) => r.sku_stock_id === selectedSkuId)) return;
    setSelectedSkuId(results[0].sku_stock_id);
  }, [results, selectedSkuId]);

  const counts = useMemo(() => ({
    all: results.length,
    needs_assign: results.filter(needsAssignment).length,
    assigned: results.filter((r) => !isDone(r) && isFullyAssigned(r)).length,
    done: results.filter(isDone).length,
  }), [results]);

  const filteredResults = useMemo(() => {
    if (viewFilter === 'all') return results;
    if (viewFilter === 'done') return results.filter(isDone);
    if (viewFilter === 'assigned') return results.filter((r) => !isDone(r) && isFullyAssigned(r));
    return results.filter(needsAssignment);
  }, [results, viewFilter]);

  const selectedRecord = useMemo(() => {
    if (selectedSkuId == null) return null;
    return results.find((r) => r.sku_stock_id === selectedSkuId) ?? null;
  }, [results, selectedSkuId]);

  const selectedStockCount = useMemo(() => {
    if (selectedRecord?.stock == null) return null;
    const parsed = Number.parseInt(String(selectedRecord.stock).replace(/[^0-9-]+/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, [selectedRecord]);

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        {/* Search input */}
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 15.803" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU or product name…"
              className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-7 pr-8 text-[12px] font-semibold text-gray-800 placeholder:text-gray-500 focus:border-gray-400 focus:outline-none focus:ring-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* View filters */}
        <div className="border-b border-gray-100 px-4 py-2">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1">
            {([
              { key: 'needs_assign', label: 'Needs Assign' },
              { key: 'assigned', label: 'Assigned' },
              { key: 'done', label: 'Done' },
              { key: 'all', label: 'All' },
            ] as Array<{ key: StockViewFilter; label: string }>).map((item) => {
              const active = viewFilter === item.key;
              const count = counts[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setViewFilter(item.key)}
                  className={`rounded-lg px-2 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] transition-colors ${
                    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`ml-1 ${active ? 'text-gray-900' : 'text-gray-500'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected stock summary */}
        <div className="border-b border-gray-100 px-4 py-3">
          {selectedRecord ? (
            <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className={sectionLabel}>Currently Selected Stock</p>
                <span className={`${microBadge} tracking-wide px-1.5 py-0.5 rounded-sm ${STATUS_BADGE[selectedRecord.wa_status || 'OPEN'] ?? 'bg-gray-100 text-gray-500'}`}>
                  {(selectedRecord.wa_status || 'OPEN').replace('_', ' ')}
                </span>
              </div>
              <p className="truncate text-[12px] font-black text-gray-900">{selectedRecord.product_title || selectedRecord.sku}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {selectedRecord.sku}
                {selectedStockCount != null && (
                  <span className={`ml-1 ${selectedStockCount <= 0 ? 'text-red-600' : 'text-gray-500'}`}>
                    · Stock {selectedStockCount}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[10px] font-semibold">
                <span className={selectedRecord.assigned_tech_id ? 'text-blue-600' : 'text-orange-500'}>
                  {selectedRecord.assigned_tech_name || 'Tech unassigned'}
                </span>
                <span className="text-gray-500"> · </span>
                <span className={selectedRecord.assigned_packer_id ? 'text-emerald-600' : 'text-orange-500'}>
                  {selectedRecord.assigned_packer_name || 'Packer unassigned'}
                </span>
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setAssigningRow(toWorkOrderRow(selectedRecord))}
                  className={`h-8 rounded-lg px-3 ${sectionLabel} transition-colors ${
                    needsAssignment(selectedRecord)
                      ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {needsAssignment(selectedRecord) ? 'Assign Selected' : 'Edit Selected'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[10px] font-semibold text-gray-500">No stock item selected</p>
          )}
        </div>

        {/* Results list */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-red-500">{error}</p>
            </div>
          ) : !query.trim() ? (
            <div className="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
              <svg className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 15.803" />
              </svg>
              <p className="text-[12px] font-semibold text-gray-500">Search to find a SKU</p>
              <p className="text-[11px] text-gray-500">
                Type a SKU or product name, then assign a tech and packer
              </p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 px-8 py-12 text-center">
              <p className="text-[12px] font-semibold text-gray-500">
                No {viewFilter === 'needs_assign' ? 'assignable' : viewFilter} results for &ldquo;{query}&rdquo;
              </p>
              <p className="text-[11px] text-gray-500">Try another filter or search term</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {filteredResults.map((r) => {
                const fullyAssigned = isFullyAssigned(r);
                const selected = selectedSkuId === r.sku_stock_id;

                return (
                  <li
                    key={r.sku_stock_id}
                    className={`px-4 py-3 cursor-pointer transition-colors ${selected ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                    onClick={() => setSelectedSkuId(r.sku_stock_id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: product info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {r.wa_status && (
                            <span className={`${microBadge} tracking-wide px-1.5 py-0.5 rounded-sm ${STATUS_BADGE[r.wa_status] ?? 'bg-gray-100 text-gray-500'}`}>
                              {r.wa_status.replace('_', ' ')}
                            </span>
                          )}
                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">
                            {r.sku}
                          </span>
                          {r.stock != null && (
                            <span className={`text-[9px] font-bold uppercase tracking-wide ${
                              Number(r.stock) <= 0 ? 'text-red-500' : 'text-gray-500'
                            }`}>
                              · Stock {r.stock}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[12px] font-bold text-gray-900 leading-snug truncate">
                          {r.product_title || r.sku}
                        </p>
                        {/* Show assigned names only when BOTH are set */}
                        {fullyAssigned && (
                          <p className="text-[10px] font-semibold text-blue-600 mt-0.5">
                            {r.assigned_tech_name}
                            {r.assigned_packer_name && (
                              <span className="text-gray-500"> · </span>
                            )}
                            {r.assigned_packer_name && (
                              <span className="text-emerald-600">{r.assigned_packer_name}</span>
                            )}
                          </p>
                        )}
                        {/* Partial assignment — nudge to finish */}
                        {!fullyAssigned && (r.assigned_tech_id || r.assigned_packer_id) && (
                          <p className="text-[10px] font-semibold text-orange-500 mt-0.5">
                            {r.assigned_tech_id ? r.assigned_tech_name : 'Tech unassigned'}
                            <span className="text-gray-500"> · </span>
                            {r.assigned_packer_id ? r.assigned_packer_name : 'Packer unassigned'}
                          </p>
                        )}
                      </div>

                      {/* Right: assign button — orange until BOTH tech + packer are set */}
                      <div className="shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSkuId(r.sku_stock_id);
                            setAssigningRow(toWorkOrderRow(r));
                          }}
                          className={[
                            `h-8 px-3 rounded-lg ${sectionLabel} tracking-wider border transition-all`,
                            fullyAssigned
                              ? 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                              : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100',
                          ].join(' ')}
                        >
                          {fullyAssigned ? 'Edit' : 'Assign'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer: result count */}
        {filteredResults.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-2 text-right">
            <span className="text-[10px] font-semibold text-gray-500">
              {filteredResults.length} shown
              {results.length !== filteredResults.length && (
                <> · {results.length} total</>
              )}
              {counts.assigned > 0 && (
                <> · <span className="text-blue-500">{counts.assigned} assigned</span></>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Assignment card overlay — same UI as all other work orders */}
      <AnimatePresence>
        {assigningRow && (
          <WorkOrderAssignmentCard
            key={assigningRow.id}
            rows={[assigningRow]}
            startIndex={0}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleConfirm}
            onClose={() => setAssigningRow(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
