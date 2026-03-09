'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShipByDate } from '../ui/ShipByDate';
import { Check, ClipboardList } from '../Icons';
import type { ActiveStationOrder, ResolvedProductManual } from '@/hooks/useStationTestingController';
import { getOrderIdLast4 } from '@/hooks/useStationTestingController';
import ProductManualViewer from './ProductManualViewer';

interface ActiveStationOrderCardProps {
  activeOrder: ActiveStationOrder;
  activeColorTextClass: string;
  resolvedManuals: ResolvedProductManual[];
  isManualLoading: boolean;
  onViewManual?: () => void;
  onSaveManual: (params: { googleLinkOrFileId: string; type?: string | null }) => Promise<{ success: boolean; error?: string }>;
}

export default function ActiveStationOrderCard({
  activeOrder,
  activeColorTextClass,
  resolvedManuals,
  isManualLoading,
  onViewManual,
  onSaveManual,
}: ActiveStationOrderCardProps) {
  const [isSavingManual, setIsSavingManual] = React.useState(false);
  const [lastAddedSerial, setLastAddedSerial] = React.useState<string | null>(null);
  const prevTrackingRef = React.useRef(activeOrder.tracking);
  const prevSerialCountRef = React.useRef(activeOrder.serialNumbers.length);

  React.useEffect(() => {
    // Reset when order changes
    if (prevTrackingRef.current !== activeOrder.tracking) {
      prevTrackingRef.current = activeOrder.tracking;
      prevSerialCountRef.current = activeOrder.serialNumbers.length;
      setLastAddedSerial(null);
      return;
    }

    const prev = prevSerialCountRef.current;
    const current = activeOrder.serialNumbers.length;
    if (current > prev) {
      const newSerial = activeOrder.serialNumbers[current - 1];
      setLastAddedSerial(newSerial);
      const timer = setTimeout(() => setLastAddedSerial(null), 1800);
      prevSerialCountRef.current = current;
      return () => clearTimeout(timer);
    }
    prevSerialCountRef.current = current;
  }, [activeOrder.serialNumbers, activeOrder.tracking]);

  const primaryManual = resolvedManuals[0] ?? null;

  const handleAddOrChangeManual = async () => {
    const linkOrId = window.prompt('Paste Google Drive view-only link (or file ID):');
    if (!linkOrId) return;
    const defaultType = primaryManual?.type || 'Product Manual';
    const type = window.prompt('Type (e.g. Product Manual, Packing List, QR Code Manual):', defaultType);

    setIsSavingManual(true);
    const result = await onSaveManual({ googleLinkOrFileId: linkOrId, type: type || null });
    setIsSavingManual(false);
    if (!result.success) {
      window.alert(result.error || 'Failed to save manual');
      return;
    }
    window.alert('Manual saved.');
  };

  return (
    <motion.div
      key={activeOrder.tracking}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      layout
    >
      {/* Single unified card */}
      <div className="rounded-2xl border border-gray-200 shadow-sm bg-white overflow-hidden">

        {/* ── Order header + details ── */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <ShipByDate date={String(activeOrder.shipByDate || activeOrder.createdAt || '')} />
            <span className="text-[9px] font-mono font-black text-gray-700">#{getOrderIdLast4(activeOrder.orderId)}</span>
          </div>

          <div className="mb-4">
            <h3 className="text-base font-black text-gray-900 leading-tight">{activeOrder.productTitle}</h3>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div
              className={`rounded-xl px-3 py-2 border ${(activeOrder.quantity || 1) > 1 ? 'bg-yellow-300 border-yellow-400' : 'bg-gray-50 border-gray-100'}`}
            >
              <p
                className={`text-[9px] font-black uppercase tracking-wider mb-1 ${(activeOrder.quantity || 1) > 1 ? 'text-yellow-900' : 'text-gray-400'}`}
              >
                Qty
              </p>
              <p className={`text-xs font-mono font-black ${(activeOrder.quantity || 1) > 1 ? 'text-yellow-900' : 'text-gray-800'}`}>
                {activeOrder.quantity || 1}
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">SKU</p>
              <p className="text-xs font-mono font-bold text-gray-800">{activeOrder.sku}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">TRK #</p>
              <p className="text-xs font-mono font-bold text-gray-800">{String(activeOrder.tracking || '').slice(-4) || '—'}</p>
            </div>
          </div>

          {activeOrder.notes && (
            <div className="space-y-3 mt-4">
              <div className="flex items-center gap-2">
                <ClipboardList className={`w-4 h-4 ${activeColorTextClass}`} />
                <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Testing Notes</p>
              </div>
              <p className="text-xs font-medium text-gray-700 bg-white/50 p-4 rounded-2xl border border-white/50 leading-relaxed">
                {activeOrder.notes}
              </p>
            </div>
          )}
        </div>

        {/* ── Manual section ── */}
        {activeOrder.orderFound !== false && (
          <div className="border-t border-blue-100 bg-blue-50/40">
            {/* Manual header row */}
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-[9px] font-black text-blue-700 uppercase tracking-wider">Product Manual</p>
                {resolvedManuals.length > 0 ? (
                  <p className="text-[10px] font-bold text-blue-900">
                    {resolvedManuals.length} manual{resolvedManuals.length > 1 ? 's' : ''} linked •{' '}
                    Matched by {primaryManual?.matchedBy === 'sku' ? 'SKU' : 'Item #'}
                  </p>
                ) : (
                  <p className="text-[10px] font-bold text-gray-500">
                    {isManualLoading ? 'Resolving manual...' : 'No manual linked for this product'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddOrChangeManual}
                  disabled={isSavingManual}
                  className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-md border border-blue-200 bg-white hover:bg-blue-50 text-[10px] font-black uppercase tracking-wider text-blue-700 disabled:opacity-60"
                >
                  {isSavingManual ? 'Saving...' : resolvedManuals.length > 0 ? 'Add Type' : 'Add Manual'}
                </button>
              </div>
            </div>

            {/* View Panel button + inline preview */}
            {resolvedManuals.length > 0 && (
              <div className="px-4 pb-3 space-y-3">
                <button
                  type="button"
                  onClick={onViewManual}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider"
                >
                  View Full Panel
                </button>
                <div className="h-64 rounded-xl overflow-hidden">
                  <ProductManualViewer manuals={resolvedManuals} isLoading={isManualLoading} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Serial numbers section — animated expand below manual ── */}
        <AnimatePresence initial={false}>
          {activeOrder.serialNumbers.length > 0 && (
            <motion.div
              key="serials-section"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320, mass: 0.7 }}
              className="overflow-hidden border-t border-emerald-100"
            >
              <div className="p-4 bg-emerald-50/60 space-y-2">
                <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wider">
                  Scanned Serials ({activeOrder.serialNumbers.length})
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {activeOrder.serialNumbers.map((sn) => {
                      const isNew = sn === lastAddedSerial;
                      return (
                        <motion.div
                          key={sn}
                          initial={{ opacity: 0, y: -10, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ type: 'spring', damping: 22, stiffness: 380 }}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors duration-500 ${
                            isNew
                              ? 'bg-emerald-200 border-emerald-400 shadow-sm'
                              : 'bg-white border-emerald-100'
                          }`}
                        >
                          <Check className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                          <span className="text-xs font-mono font-bold text-emerald-700 flex-1">{sn}</span>
                          <AnimatePresence>
                            {isNew && (
                              <motion.span
                                initial={{ opacity: 0, scale: 0.7, x: 4 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ type: 'spring', damping: 18, stiffness: 400 }}
                                className="text-[9px] font-black text-emerald-600 uppercase tracking-wider"
                              >
                                ✓ Added
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
