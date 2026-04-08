'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Package, X } from '@/components/Icons';
import { TabSwitch } from '@/design-system/components';
import { sectionLabel, chipText, dataValue, microBadge } from '@/design-system/tokens/typography/presets';
import { framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';

interface ReceivingLine {
  id: number;
  receiving_id: number | null;
  item_name: string | null;
  sku: string | null;
  zoho_purchaseorder_id: string | null;
  zoho_line_item_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string;
  qa_status: string;
  condition_grade: string;
  needs_test: boolean;
  assigned_tech_name: string | null;
  notes: string | null;
}

interface PendingBox {
  receiving_id: number;
  tracking_number: string | null;
  carrier: string | null;
  received_at: string | null;
  qa_status: string;
  zoho_purchase_receive_id: string | null;
  zoho_purchaseorder_id: string | null;
  line_count: number;
  total_expected: number;
  total_received: number;
  has_test_items: boolean;
  lines: ReceivingLine[];
}

interface ReceivingSerial {
  id: number;
  serial_number: string;
  serial_type: string;
  tested_by: number | null;
  station_source: string;
  receiving_line_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const WORKFLOW_BADGE: Record<string, string> = {
  EXPECTED:      'bg-gray-100 text-gray-500',
  ARRIVED:       'bg-blue-100 text-blue-600',
  MATCHED:       'bg-indigo-100 text-indigo-700',
  UNBOXED:       'bg-yellow-100 text-yellow-700',
  AWAITING_TEST: 'bg-orange-100 text-orange-700',
  IN_TEST:       'bg-teal-100 text-teal-700',
  PASSED:        'bg-emerald-100 text-emerald-700',
  FAILED:        'bg-red-100 text-red-600',
  RTV:           'bg-rose-100 text-rose-600',
  SCRAP:         'bg-gray-200 text-gray-500',
  DONE:          'bg-green-100 text-green-700',
};

function BoxRow({
  box,
  isActive,
  onSelect,
  onOpen,
}: {
  box: PendingBox;
  isActive: boolean;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const carrierShort = (box.carrier ?? 'PKG').toUpperCase().slice(0, 6);
  const trackingShort = box.tracking_number ? box.tracking_number.slice(-8) : '--------';
  const receivedTime = box.received_at
    ? (() => {
        const m = String(box.received_at).match(/(?:T|\s)(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]}` : '';
      })()
    : '';
  const progressPct =
    box.total_expected > 0
      ? Math.min(100, Math.round((box.total_received / box.total_expected) * 100))
      : 0;

  return (
    <motion.div
      layout
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all cursor-pointer border ${
        isActive
          ? 'bg-indigo-50 border-indigo-200 shadow-sm'
          : 'bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-200'
      }`}
      onClick={() => onSelect(box.receiving_id)}
    >
      {/* Carrier badge */}
      <div className={`flex-shrink-0 w-10 h-8 rounded-lg flex flex-col items-center justify-center ${
        isActive ? 'bg-indigo-100 border border-indigo-200' : 'bg-gray-50 border border-gray-100'
      }`}>
        <span className={`${microBadge} leading-none ${isActive ? 'text-indigo-500' : 'text-gray-500'}`}>
          {carrierShort}
        </span>
        <span className={`text-[9px] font-bold font-mono leading-none mt-0.5 ${isActive ? 'text-indigo-700' : 'text-gray-700'}`}>
          {trackingShort.slice(-4)}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`${chipText} tabular-nums ${isActive ? 'text-indigo-700' : 'text-gray-700'}`}>
            #{box.receiving_id}
          </span>
          {receivedTime && (
            <span className={`${microBadge} text-gray-500`}>{receivedTime}</span>
          )}
          {box.has_test_items && (
            <span className={`${microBadge} px-1 py-0.5 rounded bg-orange-100 text-orange-600`}>Test</span>
          )}
          {box.zoho_purchaseorder_id && (
            <span className={`${microBadge} px-1 py-0.5 rounded bg-indigo-50 text-indigo-500 border border-indigo-100`}>PO</span>
          )}
        </div>
        {box.line_count > 0 ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-gray-500">{box.line_count} item{box.line_count !== 1 ? 's' : ''}</span>
            {box.total_expected > 0 && (
              <>
                <div className="h-1 w-12 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${progressPct === 100 ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className={`${microBadge} text-gray-500 tabular-nums`}>
                  {box.total_received}/{box.total_expected}
                </span>
              </>
            )}
          </div>
        ) : (
          <p className="text-[9px] font-semibold text-gray-400 italic">No PO linked</p>
        )}
      </div>

      {/* Open details arrow */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(box.receiving_id); }}
        className={`flex-shrink-0 p-1 rounded-lg transition-colors ${
          isActive ? 'hover:bg-indigo-100 text-indigo-400' : 'hover:bg-gray-100 text-gray-400'
        }`}
        title="Open details"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

function LineItemsPanel({
  receivingId,
  trackingNumber,
  carrier,
  cachedLines,
  staffId,
  onClose,
}: {
  receivingId: number;
  trackingNumber: string | null;
  carrier: string | null;
  cachedLines: ReceivingLine[];
  staffId: number | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [activeSerialLineId, setActiveSerialLineId] = useState<number | null>(null);

  const hasCachedLines = cachedLines.length > 0;

  const { data, isLoading } = useQuery<{ success: boolean; receiving_lines: ReceivingLine[] }>({
    queryKey: ['receiving-lines', receivingId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 10_000,
    // Skip the fetch entirely when lines are pre-loaded from the parent query
    enabled: !hasCachedLines,
    placeholderData: hasCachedLines
      ? { success: true, receiving_lines: cachedLines }
      : undefined,
  });

  const lines = data?.receiving_lines ?? cachedLines;
  const trackingDisplay = trackingNumber ? `…${trackingNumber.slice(-10)}` : `#${receivingId}`;
  const carrierLabel = carrier ? carrier.toUpperCase().slice(0, 6) : '';

  const toggleSerialEditor = (lineId: number) => {
    setActiveSerialLineId((prev) => (prev === lineId ? null : lineId));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white border-t-2 border-indigo-100">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border-b border-indigo-100">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className={`${microBadge} tracking-widest text-indigo-600 leading-none`}>
              Line Items
            </p>
            <p className={`${chipText} text-indigo-800 mt-0.5 truncate`}>
              {carrierLabel && <span className="mr-1 text-indigo-400">{carrierLabel}</span>}
              {trackingDisplay}
            </p>
          </div>
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-300 flex-shrink-0" />}
          <span className={`ml-1 ${microBadge} rounded-full px-1.5 py-0.5 ${lines.length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
            {lines.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-shrink-0 p-1 rounded-lg hover:bg-indigo-100 text-indigo-400 transition-colors"
          aria-label="Close line items"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Line items list */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {isLoading && lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-60">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className={`${microBadge} tracking-widest`}>Fetching lines…</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 opacity-50">
            <Package className="w-8 h-8" />
            <p className={`${microBadge} tracking-widest text-center`}>
              No line items found
            </p>
            <p className={`${microBadge} text-gray-500 text-center px-4 normal-case`}>
              Scan the tracking number to auto-match Zoho PO lines
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {lines.map((line) => {
              const badge = WORKFLOW_BADGE[line.workflow_status] ?? 'bg-gray-100 text-gray-500';
              const progressPct = line.quantity_expected && line.quantity_expected > 0
                ? Math.min(100, Math.round((line.quantity_received / line.quantity_expected) * 100))
                : 0;
              return (
                <div key={line.id} className="px-3 py-2.5 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`${dataValue} leading-snug truncate`}>
                        {line.item_name || line.sku || `Line #${line.id}`}
                      </p>
                      {line.sku && line.item_name && (
                        <p className={`${microBadge} font-mono text-gray-500 mt-0.5 normal-case`}>{line.sku}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className={`${microBadge} tracking-wider rounded px-1.5 py-0.5 ${badge}`}>
                          {line.workflow_status.replace(/_/g, ' ')}
                        </span>
                        {line.needs_test && (
                          <span className={`${microBadge} tracking-wider rounded px-1.5 py-0.5 bg-orange-100 text-orange-600`}>
                            Test
                          </span>
                        )}
                        {line.assigned_tech_name && (
                          <span className={`${microBadge} text-gray-500 truncate normal-case`}>
                            → {line.assigned_tech_name}
                          </span>
                        )}
                      </div>
                      {line.zoho_purchaseorder_id && (
                        <p className={`${microBadge} font-mono text-indigo-500 mt-0.5 truncate normal-case`}>
                          PO {line.zoho_purchaseorder_id}
                        </p>
                      )}
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSerialEditor(line.id)}
                          className={`${microBadge} rounded border border-indigo-200 px-1.5 py-0.5 text-indigo-600 hover:bg-indigo-50`}
                        >
                          {activeSerialLineId === line.id ? 'Hide Serials' : 'Scan Serials'}
                        </button>
                      </div>
                    </div>

                    {/* Qty + progress */}
                    <div className="flex-shrink-0 text-right">
                      <span className={`${dataValue} tabular-nums text-gray-700`}>
                        {line.quantity_received}
                        <span className="text-gray-300 mx-0.5 font-normal">/</span>
                        <span className="text-gray-500 text-[11px]">{line.quantity_expected ?? '?'}</span>
                      </span>
                      {line.quantity_expected != null && line.quantity_expected > 0 && (
                        <div className="h-1 w-10 bg-gray-100 rounded-full overflow-hidden mt-1 ml-auto">
                          <div
                            className={`h-full rounded-full ${progressPct === 100 ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {line.notes && (
                    <p className="mt-1.5 text-[9px] font-semibold text-gray-500 italic truncate">
                      {line.notes}
                    </p>
                  )}

                  {activeSerialLineId === line.id && (
                    <LineSerialsSection
                      receivingId={receivingId}
                      receivingLineId={line.id}
                      staffId={staffId}
                      onChanged={() => {
                        queryClient.invalidateQueries({ queryKey: ['receiving-lines', receivingId] });
                        queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
                        queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LineSerialsSection({
  receivingId,
  receivingLineId,
  staffId,
  onChanged,
}: {
  receivingId: number;
  receivingLineId: number;
  staffId: number | null;
  onChanged?: () => void;
}) {
  const [serialInput, setSerialInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<{ success: boolean; serials: ReceivingSerial[]; count: number }>({
    queryKey: ['receiving-line-serials', receivingLineId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/serials?receiving_line_id=${receivingLineId}`);
      if (!res.ok) throw new Error('Failed to fetch serials');
      return res.json();
    },
    staleTime: 10_000,
  });

  const serials = data?.serials ?? [];

  const submitSerial = async () => {
    const serial = serialInput.trim().toUpperCase();
    if (!serial || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/receiving/serials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_line_id: receivingLineId,
          serial_number: serial,
          tested_by: staffId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setSerialInput('');
      await refetch();
      onChanged?.();
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add serial');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSerial = async (id: number) => {
    setError(null);
    try {
      const res = await fetch(`/api/receiving/serials?id=${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      await refetch();
      onChanged?.();
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete serial');
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
      <p className={`${microBadge} text-indigo-700`}>Serials for line #{receivingLineId}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={serialInput}
          onChange={(e) => setSerialInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitSerial();
            }
          }}
          placeholder="Scan serial..."
          className="flex-1 rounded border border-indigo-200 bg-white px-2 py-1 text-[10px] font-mono font-bold text-gray-900 outline-none"
        />
        <button
          type="button"
          onClick={submitSerial}
          disabled={submitting || !serialInput.trim()}
          className={`${microBadge} rounded bg-indigo-600 px-2 py-1 text-white disabled:opacity-50`}
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error && (
        <p className="mt-1 text-[9px] font-bold text-red-600">{error}</p>
      )}

      <div className="mt-2 max-h-24 overflow-y-auto rounded border border-indigo-100 bg-white/80 p-1.5">
        {isLoading ? (
          <p className={`${microBadge} text-gray-500`}>Loading serials…</p>
        ) : serials.length === 0 ? (
          <p className={`${microBadge} text-gray-500`}>No serials yet</p>
        ) : (
          <div className="space-y-1">
            {serials.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1">
                <span className="truncate text-[10px] font-mono font-bold text-gray-800">{row.serial_number}</span>
                <button
                  type="button"
                  onClick={() => deleteSerial(row.id)}
                  className={`${microBadge} text-red-600 hover:text-red-700`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-[8px] font-semibold uppercase tracking-wider text-gray-500">
        Receiving #{receivingId} · Source: RECEIVING
      </p>
    </div>
  );
}

interface PendingUnboxingQueueProps {
  onSelectReceivingId?: (id: number) => void;
  staffId?: number | null;
}

export default function PendingUnboxingQueue({ onSelectReceivingId, staffId = null }: PendingUnboxingQueueProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'unboxed' | 'all'>('pending');
  const [activeBoxId, setActiveBoxId] = useState<number | null>(null);

  const statusParam =
    statusFilter === 'unboxed' ? 'UNBOXED' : statusFilter === 'all' ? 'ALL' : 'ARRIVED,MATCHED';

  const { data, isLoading, isFetching, refetch } = useQuery<{ pending: PendingBox[]; total: number }>({
    queryKey: ['receiving-pending-unboxing', statusFilter],
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving/pending-unboxing?limit=100&status=${statusParam}`,
      );
      if (!res.ok) throw new Error('Failed to fetch pending unboxing');
      return res.json();
    },
    staleTime: 45_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const boxes = data?.pending ?? [];
  const total = data?.total ?? 0;
  const activeBox = boxes.find((b) => b.receiving_id === activeBoxId) ?? null;

  const tabs = [
    { id: 'pending' as const, label: 'Awaiting Unbox' },
    { id: 'unboxed' as const, label: 'In Progress' },
    { id: 'all' as const, label: 'All' },
  ];

  const handleSelect = (id: number) => {
    setActiveBoxId((prev) => (prev === id ? null : id));
  };

  const handleOpen = (id: number) => {
    onSelectReceivingId?.(id);
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Package className="w-3.5 h-3.5 text-indigo-500" />
          <span className={sectionLabel}>
            Pending Unboxing
          </span>
          <span className={`${microBadge} rounded-full px-1.5 py-0.5 tabular-nums ${total > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
            {total}
          </span>
          {isFetching && !isLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-300" />}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className={`${microBadge} tracking-widest text-gray-500 hover:text-gray-700 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-100`}
        >
          ↻
        </button>
      </div>

      {/* Filter tabs */}
      <div className="px-3 py-1.5 border-b border-gray-50 flex-shrink-0">
        <TabSwitch
          tabs={tabs.map((t) => ({ id: t.id, label: t.label, color: 'blue' as const }))}
          activeTab={statusFilter}
          onTabChange={(id) => { setStatusFilter(id as typeof statusFilter); setActiveBoxId(null); }}
        />
      </div>

      {/* Box list — takes remaining space when no panel open, or fixed portion */}
      <div className={`overflow-y-auto px-3 py-2 space-y-1.5 flex-shrink-0 ${activeBox ? 'max-h-[45%]' : 'flex-1'}`}
        style={{ scrollbarWidth: 'none' }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 opacity-60">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className={`${microBadge} tracking-widest`}>Loading…</p>
          </div>
        ) : boxes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center opacity-50">
            <Package className="w-10 h-10 mb-2" />
            <p className={`${microBadge} tracking-widest`}>
              {statusFilter === 'pending' ? 'No boxes awaiting unboxing' : 'Nothing to show'}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {boxes.map((box) => (
              <BoxRow
                key={box.receiving_id}
                box={box}
                isActive={box.receiving_id === activeBoxId}
                onSelect={handleSelect}
                onOpen={handleOpen}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Line items panel — below the box list, shown when a box is selected */}
      <AnimatePresence>
        {activeBox && (
          <motion.div
            key={activeBox.receiving_id}
            {...framerPresence.stationCard}
            transition={framerTransition.stationCardMount}
            className="flex-1 min-h-0 overflow-hidden"
          >
            <LineItemsPanel
              receivingId={activeBox.receiving_id}
              trackingNumber={activeBox.tracking_number}
              carrier={activeBox.carrier}
              cachedLines={activeBox.lines}
              staffId={staffId}
              onClose={() => setActiveBoxId(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
