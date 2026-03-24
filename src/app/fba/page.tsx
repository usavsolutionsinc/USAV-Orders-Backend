'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { type FbaPlanSummaryMode } from '@/components/fba/FbaShipmentBoard';
import { FbaPrintReadyTable } from '@/components/fba/FbaPrintReadyTable';
import { FbaShippedHistory } from '@/components/fba/FbaShippedHistory';
import { FbaFnskuChecklist } from '@/components/fba/FbaFnskuChecklist';

type Tab = 'summary' | 'shipped';

function resolveSummaryMode(rawMode: string | null, rawStatus: string | null): FbaPlanSummaryMode | null {
  const mode = String(rawMode || '').toUpperCase();
  if (mode === 'PLAN' || mode === 'PACKING' || mode === 'OUT_OF_STOCK' || mode === 'STOCK') return 'PLAN';
  if (mode === 'PRINT_READY') return 'PRINT_READY';
  if (mode === 'READY_TO_GO' || mode === 'READY_TO_PRINT') return 'PRINT_READY';
  if (mode === 'ALL') return 'PLAN';
  const legacyStatus = String(rawStatus || '').toUpperCase();
  if (legacyStatus === 'PLANNED') return 'PLAN';
  if (legacyStatus === 'READY_TO_GO' || legacyStatus === 'READY_TO_PRINT') return 'PRINT_READY';
  return null;
}

function resolveActiveTab(rawTab: string | null): Tab {
  if (rawTab === 'shipped') return 'shipped';
  return 'summary';
}

function buildFbaHref(params: URLSearchParams) {
  const query = params.toString();
  return query ? `/fba?${query}` : '/fba';
}

function FbaPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const summaryMode = resolveSummaryMode(searchParams.get('mode'), searchParams.get('status'));
  const refreshTrigger = Number(searchParams.get('r') || 0);
  const searchQuery = searchParams.get('q') || '';
  const activeTab = resolveActiveTab(searchParams.get('tab'));
  const legacyLabelsTab = searchParams.get('tab') === 'labels';

  // Draft FNSKUs from sidebar input
  const draftParam = searchParams.get('draft') || '';
  const draftFnskus = draftParam ? draftParam.split(',').filter(Boolean) : [];
  const hasDraft = draftFnskus.length > 0;

  // Existing plan selected from sidebar
  const planParam = searchParams.get('plan');
  const planId = planParam ? Number(planParam) : null;
  const hasPlan = Boolean(planId && Number.isFinite(planId) && planId > 0);

  // Status filter from sidebar third slider
  const statusFilter = searchParams.get('filter') || 'ALL';
  const clearDraftOrPlan = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('draft');
    params.delete('plan');
    router.replace(buildFbaHref(params));
  };

  const handleCreated = (_id: number, _ref: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('draft');
    params.set('r', String(Date.now()));
    params.set('mode', 'PLAN');
    router.replace(buildFbaHref(params));
  };

  // Refresh trigger for print table (listen for fba-print-shipped event)
  const [printRefresh, setPrintRefresh] = useState(0);
  const [printLabelReadyByShipment, setPrintLabelReadyByShipment] = useState<Record<number, boolean>>({});

  // Listen to fba-print-shipped to refresh the table
  useEffect(() => {
    const handler = () => setPrintRefresh((n) => n + 1);
    window.addEventListener('fba-print-shipped', handler);
    return () => window.removeEventListener('fba-print-shipped', handler);
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ readyByShipmentId?: Record<number, boolean> }>;
      setPrintLabelReadyByShipment(e.detail?.readyByShipmentId || {});
    };
    window.addEventListener('fba-print-sidebar-ready', handler);
    return () => window.removeEventListener('fba-print-sidebar-ready', handler);
  }, []);

  // Legacy URLs: mode=out_of_stock → plan view + filter
  useEffect(() => {
    const mode = String(searchParams.get('mode') || '').toUpperCase();
    if (mode !== 'OUT_OF_STOCK' && mode !== 'STOCK') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('mode', 'PLAN');
    params.set('filter', 'OUT_OF_STOCK');
    router.replace(buildFbaHref(params));
  }, [searchParams, router]);

  const isPrintMainView = legacyLabelsTab || summaryMode === 'PRINT_READY';

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-stone-50">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-zinc-200/80 bg-white">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

              {/* Specific plan selected from sidebar */}
              {activeTab === 'shipped' ? (
                <FbaShippedHistory refreshTrigger={refreshTrigger} />

              ) : isPrintMainView ? (
                <FbaPrintReadyTable
                  refreshTrigger={printRefresh}
                  shipmentLabelReady={printLabelReadyByShipment}
                />

              ) : hasPlan ? (
                <FbaFnskuChecklist planId={planId!} statusFilter={statusFilter} onClear={clearDraftOrPlan} />

              /* Draft FNSKUs pasted — review before adding to today's plan */
              ) : hasDraft ? (
                <FbaFnskuChecklist fnskus={draftFnskus} onClear={clearDraftOrPlan} onCreated={handleCreated} />

              ) : (
                <FbaFnskuChecklist key={refreshTrigger} statusFilter={statusFilter} />
              )}

        </div>
      </div>
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-stone-100/80 px-6">
          <div className="rounded-2xl border border-zinc-200/80 bg-white px-6 py-5 text-center shadow-sm shadow-zinc-200/70">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-indigo-600" />
            <p className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-700">
              Loading FBA workspace
            </p>
          </div>
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
