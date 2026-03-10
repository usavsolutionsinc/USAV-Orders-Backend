'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Loader2, Package } from '@/components/Icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface ReceivingLine {
  id: number;
  item_name: string | null;
  sku: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string;
  qa_status: string;
  condition_grade: string;
  needs_test: boolean;
  assigned_tech_name: string | null;
  notes: string | null;
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
};

interface PoLinesSectionProps {
  receivingId: string;
  trackingNumber?: string;
}

export function PoLinesSection({ receivingId, trackingNumber }: PoLinesSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [markingReceived, setMarkingReceived] = useState(false);
  const [markResult, setMarkResult] = useState<'idle' | 'ok' | 'err'>('idle');
  const queryClient = useQueryClient();

  const { data, isFetching, refetch } = useQuery<{ lines: ReceivingLine[]; matched: boolean }>({
    queryKey: ['receiving-match', receivingId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/match?receiving_id=${receivingId}`, { cache: 'no-store' });
      if (!res.ok) return { lines: [], matched: false };
      const json = await res.json();
      const lines: ReceivingLine[] = Array.isArray(json?.matched_lines) ? json.matched_lines : [];
      return { lines, matched: lines.length > 0 };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const lines = data?.lines ?? [];
  const hasLines = lines.length > 0;
  const poIds = Array.from(new Set(lines.map((l) => l.zoho_purchaseorder_id).filter(Boolean))) as string[];
  const totalExpected = lines.reduce((s, l) => s + (l.quantity_expected ?? 0), 0);
  const totalReceived = lines.reduce((s, l) => s + (l.quantity_received ?? 0), 0);

  const handleSearchAndLink = async () => {
    if (!trackingNumber?.trim()) return;
    setMarkingReceived(true);
    setMarkResult('idle');
    try {
      const res = await fetch('/api/receiving/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiving_id: Number(receivingId) }),
      });
      if (!res.ok) throw new Error('Match failed');
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
      setMarkResult('ok');
    } catch {
      setMarkResult('err');
    } finally {
      setMarkingReceived(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-indigo-500 flex-shrink-0" />
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">
            PO Lines {hasLines ? `(${lines.length})` : ''}
          </span>
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />}
          {hasLines && (
            <span className="text-[9px] font-bold text-indigo-400">
              {totalReceived}/{totalExpected} units
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-indigo-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {poIds.length > 0 && (
                <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">
                  PO: {poIds.join(', ')}
                </p>
              )}

              {lines.length === 0 ? (
                <div className="text-center py-4 space-y-2">
                  <p className="text-[10px] font-bold text-gray-400">No PO lines linked yet.</p>
                  <button
                    type="button"
                    onClick={handleSearchAndLink}
                    disabled={markingReceived}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
                  >
                    {markingReceived ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
                    Search Zoho PO
                  </button>
                  {markResult === 'err' && (
                    <p className="text-[9px] text-red-500 font-bold">Search failed — try again</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => {
                    const badgeCls = WORKFLOW_BADGE[line.workflow_status] ?? 'bg-gray-100 text-gray-500';
                    const qtyOk = (line.quantity_expected ?? 0) > 0
                      ? line.quantity_received >= (line.quantity_expected ?? 0)
                      : false;
                    return (
                      <div
                        key={line.id}
                        className="rounded-xl border border-indigo-100 bg-white px-3 py-2.5 flex items-start gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-gray-900 leading-tight truncate">
                            {line.item_name || line.sku || `Line #${line.id}`}
                          </p>
                          {line.sku && line.item_name && (
                            <p className="text-[10px] font-mono text-gray-400 mt-0.5">{line.sku}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className={`text-[9px] font-black uppercase tracking-widest rounded px-1.5 py-0.5 ${badgeCls}`}>
                              {line.workflow_status.replace('_', ' ')}
                            </span>
                            {line.needs_test && (
                              <span className="text-[9px] font-black uppercase tracking-widest rounded px-1.5 py-0.5 bg-orange-100 text-orange-700">
                                Test
                              </span>
                            )}
                            {line.assigned_tech_name && (
                              <span className="text-[9px] font-bold text-gray-400 truncate">
                                → {line.assigned_tech_name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-sm font-black tabular-nums ${qtyOk ? 'text-emerald-600' : 'text-gray-700'}`}>
                            {line.quantity_received}
                            <span className="text-gray-300 mx-0.5">/</span>
                            <span className="text-gray-400">{line.quantity_expected ?? '?'}</span>
                          </p>
                          {qtyOk && <Check className="h-3 w-3 text-emerald-500 ml-auto" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
