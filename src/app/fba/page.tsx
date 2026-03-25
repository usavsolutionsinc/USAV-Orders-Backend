'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { FbaPrintReadyTable } from '@/components/fba/FbaPrintReadyTable';
import { FbaShippedHistory } from '@/components/fba/FbaShippedHistory';
import { FbaFnskuChecklist } from '@/components/fba/FbaFnskuChecklist';
import { FbaFnskuDirectoryPanel } from '@/components/fba/FbaFnskuDirectoryPanel';
import { SearchBar } from '@/components/ui/SearchBar';
import StationFba from '@/components/station/StationFba';

type Tab = 'summary' | 'shipped';
type DetailsPanel = 'none' | 'catalog';

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

  const refreshTrigger = Number(searchParams.get('r') || 0);
  const activeTab = resolveActiveTab(searchParams.get('tab'));

  const draftParam = searchParams.get('draft') || '';
  const draftFnskus = draftParam ? draftParam.split(',').filter(Boolean) : [];
  const hasDraft = draftFnskus.length > 0;

  /** `fba_shipments.id` (internal row id), not the plan code (`shipment_ref`). */
  const planParam = searchParams.get('plan');
  const planId = planParam ? Number(planParam) : null;
  const hasPlan = Boolean(planId && Number.isFinite(planId) && planId > 0);

  const statusFilter = searchParams.get('filter') || 'ALL';
  const workspacePanel = searchParams.get('main') === 'plan' ? 'plan' : 'print';
  const detailsPanel: DetailsPanel =
    activeTab === 'shipped'
      ? 'none'
      : searchParams.get('details') === 'catalog'
        ? 'catalog'
        : 'none';
  const showFnskuCatalog = activeTab !== 'shipped' && detailsPanel === 'catalog';
  const staffIdParam = String(searchParams.get('staffId') || '').trim();
  const staffIdForTheme = /^\d+$/.test(staffIdParam) ? staffIdParam : null;

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
    router.replace(buildFbaHref(params));
  };

  const [printRefresh, setPrintRefresh] = useState(0);
  const [catalogSearch, setCatalogSearch] = useState('');

  useEffect(() => {
    const handler = () => setPrintRefresh((n) => n + 1);
    window.addEventListener('fba-print-shipped', handler);
    return () => window.removeEventListener('fba-print-shipped', handler);
  }, []);

  useEffect(() => {
    const mode = String(searchParams.get('mode') || '').toUpperCase();
    const tab = searchParams.get('tab');
    const legacyPrint =
      mode === 'PRINT_READY' ||
      mode === 'READY_TO_GO' ||
      mode === 'READY_TO_PRINT' ||
      tab === 'labels';
    if (!legacyPrint) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('mode');
    params.delete('print');
    if (tab === 'labels') params.delete('tab');
    router.replace(buildFbaHref(params));
  }, [searchParams, router]);

  useEffect(() => {
    const mode = String(searchParams.get('mode') || '').toUpperCase();
    if (mode !== 'OUT_OF_STOCK' && mode !== 'STOCK') return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('mode');
    params.set('filter', 'OUT_OF_STOCK');
    router.replace(buildFbaHref(params));
  }, [searchParams, router]);

  const mainWorkspace = (
    <>
      {activeTab === 'shipped' ? (
        <FbaShippedHistory refreshTrigger={refreshTrigger} />
      ) : showFnskuCatalog ? (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <div className="shrink-0 space-y-2 border-b border-zinc-200 bg-white px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">FNSKU catalog</p>
              <Link
                href="/admin?section=fba"
                className="text-[10px] font-bold uppercase tracking-wide text-violet-700 hover:text-violet-900"
              >
                Open in admin →
              </Link>
            </div>
            <SearchBar
              value={catalogSearch}
              onChange={setCatalogSearch}
              onClear={() => setCatalogSearch('')}
              placeholder="Search title, ASIN, SKU, FNSKU…"
              variant="blue"
              className="w-full"
            />
            <p className="text-[10px] font-medium leading-relaxed text-zinc-500">
              Same directory as Admin → FBA. Add or import CSV from admin for bulk edits.
            </p>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3 sm:p-4">
            <FbaFnskuDirectoryPanel
              searchTerm={catalogSearch}
              variant="admin"
              className="h-full min-h-0 rounded-xl shadow-sm shadow-zinc-200/60"
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
            {workspacePanel === 'print' ? (
              <div id="fba-print-queue" className="flex h-full min-h-0 flex-col">
                <FbaPrintReadyTable
                  refreshTrigger={printRefresh}
                  fitHeightNoScroll
                  staffId={staffIdForTheme}
                />
              </div>
            ) : hasPlan ? (
              <FbaFnskuChecklist
                planId={planId!}
                statusFilter={statusFilter}
                onClear={clearDraftOrPlan}
                suppressListScroll
              />
            ) : hasDraft ? (
              <FbaFnskuChecklist
                fnskus={draftFnskus}
                onClear={clearDraftOrPlan}
                onCreated={handleCreated}
                suppressListScroll
              />
            ) : (
              <FbaFnskuChecklist key={refreshTrigger} statusFilter={statusFilter} suppressListScroll />
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-stone-50">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-zinc-200/80 bg-white">
        <StationFba embedded>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:min-h-0">
            {mainWorkspace}
          </div>
        </StationFba>
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
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-700">
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
