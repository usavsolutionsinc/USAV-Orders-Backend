'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { FbaShipmentBoard } from '@/components/fba/FbaShipmentBoard';
import { FbaLabelQueue } from '@/components/fba/FbaLabelQueue';
import { FbaShippedTable } from '@/components/fba/FbaShippedTable';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { ShippedDetailsPanel } from '@/components/shipped';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

type Tab = 'summary' | 'labels' | 'shipped';
type SummaryMode = 'ALL' | 'PACKING' | 'STOCK';

function resolveSummaryMode(rawMode: string | null, rawStatus: string | null): SummaryMode {
  const mode = String(rawMode || '').toUpperCase();
  if (mode === 'ALL' || mode === 'PACKING' || mode === 'STOCK') return mode as SummaryMode;
  if (mode === 'PLAN' || mode === 'TESTED') return 'STOCK';
  if (mode === 'READY_TO_GO' || mode === 'READY_TO_PRINT') return 'ALL';

  const legacyStatus = String(rawStatus || '').toUpperCase();
  if (legacyStatus === 'PLANNED') return 'STOCK';
  if (legacyStatus === 'READY_TO_GO' || legacyStatus === 'LABEL_ASSIGNED' || legacyStatus === 'SHIPPED') return 'ALL';
  return 'ALL';
}

function resolveActiveTab(rawTab: string | null): Tab {
  if (rawTab === 'labels') return 'labels';
  if (rawTab === 'shipped') return 'shipped';
  return 'summary';
}

function FbaPageContent() {
  const searchParams = useSearchParams();
  const summaryMode = resolveSummaryMode(searchParams.get('mode'), searchParams.get('status'));
  const refreshTrigger = Number(searchParams.get('r') || 0);
  const searchQuery = searchParams.get('q') || '';
  const activeTab = resolveActiveTab(searchParams.get('tab'));
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);

  useEffect(() => {
    const handleOpen = (event: CustomEvent<ShippedOrder>) => {
      if (event.detail) setSelectedShipped(event.detail);
    };
    const handleClose = () => setSelectedShipped(null);

    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'shipped' && selectedShipped) {
      window.dispatchEvent(new CustomEvent('close-shipped-details'));
      setSelectedShipped(null);
    }
  }, [activeTab, selectedShipped]);

  useEffect(() => {
    const handleAssignmentUpdate = (event: any) => {
      const detail = event?.detail || {};
      const ids = new Set<number>((detail.orderIds || []).map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)));
      if (ids.size === 0) return;

      setSelectedShipped((current) => {
        if (!current || !ids.has(Number(current.id))) return current;

        const next: any = { ...current };
        if (detail.testerId !== undefined) next.tester_id = detail.testerId;
        if (detail.packerId !== undefined) next.packer_id = detail.packerId;
        if (detail.shipByDate !== undefined) next.ship_by_date = detail.shipByDate;
        if (detail.outOfStock !== undefined) next.out_of_stock = detail.outOfStock;
        if (detail.notes !== undefined) next.notes = detail.notes;
        if (detail.shippingTrackingNumber !== undefined) next.shipping_tracking_number = detail.shippingTrackingNumber;
        if (detail.itemNumber !== undefined) next.item_number = detail.itemNumber;
        if (detail.condition !== undefined) next.condition = detail.condition;
        return next;
      });
    };

    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);
    return () => window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);
  }, []);

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <div className="flex h-full min-w-0 flex-1 bg-white relative">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className={mainStickyHeaderClass}>
              <div className={mainStickyHeaderRowClass}>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">FBA</p>
                {searchQuery.trim() ? (
                  <p className="min-w-0 max-w-[min(100%,20rem)] truncate text-right text-[10px] font-bold text-gray-500">
                    Filter: {searchQuery.trim()}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === 'summary' ? (
                <FbaShipmentBoard
                  summaryMode={summaryMode}
                  refreshTrigger={refreshTrigger}
                  searchQuery={searchQuery}
                />
              ) : activeTab === 'labels' ? (
                <FbaLabelQueue refreshTrigger={refreshTrigger} />
              ) : (
                <FbaShippedTable refreshTrigger={refreshTrigger} />
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {activeTab === 'shipped' && selectedShipped ? (
          <ShippedDetailsPanel
            shipped={selectedShipped}
            context="dashboard"
            onClose={() => {
              window.dispatchEvent(new CustomEvent('close-shipped-details'));
              setSelectedShipped(null);
            }}
            onUpdate={() => {
              window.dispatchEvent(new CustomEvent('dashboard-refresh'));
              window.dispatchEvent(new CustomEvent('usav-refresh-data'));
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <div className="text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Loading FBA
            </p>
          </div>
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
