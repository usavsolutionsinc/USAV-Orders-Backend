'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { FbaAddToShipmentPanel } from '@/components/sidebar/FbaAddToShipmentPanel';
import { FbaFnskuPlanInput } from '@/components/sidebar/FbaFnskuPlanInput';
import { FbaPrintSidebarBlock } from '@/components/sidebar/FbaPrintSidebarBlock';
import { FbaSummaryPlansList, type FbaSidebarPendingPlan } from '@/components/sidebar/FbaSummaryPlansList';

type FbaTab = 'summary' | 'shipped';
type FbaSummaryView = 'plan' | 'print';

const fbaSidebarHeaderBand = 'shrink-0 border-b border-gray-200 bg-white';

function resolveSummaryView(rawMode: string | null, rawStatus: string | null, rawTab: string | null): FbaSummaryView {
  if (rawTab === 'labels') return 'print';
  const mode = String(rawMode || '').toUpperCase();
  if (mode === 'PRINT_READY' || mode === 'READY_TO_GO' || mode === 'READY_TO_PRINT') return 'print';
  if (mode === 'PLAN' || mode === 'PACKING' || mode === 'OUT_OF_STOCK' || mode === 'STOCK' || mode === 'ALL') return 'plan';
  const legacyStatus = String(rawStatus || '').toUpperCase();
  if (legacyStatus === 'READY_TO_GO' || legacyStatus === 'READY_TO_PRINT') return 'print';
  return 'plan';
}

type PendingPlan = FbaSidebarPendingPlan;

function FbaSidebarPanelFallback() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={`${fbaSidebarHeaderBand} px-3 py-2`}>
        <div className="h-9 w-full rounded-xl bg-gray-100" />
      </div>
      <div className={`${fbaSidebarHeaderBand} flex h-11 items-center px-3`}>
        <div className="h-8 w-full rounded-lg bg-gray-100" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white" />
    </div>
  );
}

function FbaSidebarPanelInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab: FbaTab = searchParams.get('tab') === 'shipped' ? 'shipped' : 'summary';
  const activePlanId = searchParams.get('plan') ? Number(searchParams.get('plan')) : null;
  const summaryView = resolveSummaryView(
    searchParams.get('mode'),
    searchParams.get('status'),
    searchParams.get('tab')
  );

  const [localSearch, setLocalSearch] = useState('');
  const urlHydratedRef = useRef(false);

  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [deletingPlanId, setDeletingPlanId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [duplicating, setDuplicating] = useState(false);
  const [dupToast, setDupToast] = useState<string | null>(null);

  const [planQtyDraft, setPlanQtyDraft] = useState<Record<number, string>>({});
  const [qtySavingPlanId, setQtySavingPlanId] = useState<number | null>(null);

  const refreshToken = Number(searchParams.get('r') || 0);

  const updateFbaParams = useCallback(
    (patch: {
      q?: string;
      r?: string;
      tab?: FbaTab;
      draft?: string | null;
      plan?: number | null;
      mode?: 'PLAN' | 'PRINT_READY' | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.q !== undefined) {
        if (patch.q.trim()) params.set('q', patch.q.trim());
        else params.delete('q');
      }
      if (patch.tab !== undefined) {
        if (patch.tab === 'summary') params.delete('tab');
        else params.set('tab', patch.tab);
      }
      if (patch.r !== undefined) params.set('r', patch.r);
      if (patch.draft !== undefined) {
        if (patch.draft) params.set('draft', patch.draft);
        else params.delete('draft');
      }
      if (patch.plan !== undefined) {
        if (patch.plan) {
          params.set('plan', String(patch.plan));
          params.delete('draft');
        } else {
          params.delete('plan');
        }
      }
      if (patch.mode !== undefined) {
        if (patch.mode) params.set('mode', patch.mode);
        else params.delete('mode');
      }
      router.replace(`/fba?${params.toString()}`);
    },
    [router, searchParams]
  );

  useLayoutEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
    urlHydratedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!urlHydratedRef.current) return;
    const t = setTimeout(() => {
      const next = localSearch.trim();
      const cur = (searchParams.get('q') || '').trim();
      if (next === cur) return;
      updateFbaParams({ q: localSearch });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const loadPendingPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await fetch('/api/fba/shipments?status=PLANNED&limit=50', { cache: 'no-store' });
      const data = await res.json();
      if (!Array.isArray(data?.shipments)) return;
      const sorted = [...data.shipments].sort((a: any, b: any) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
      setPendingPlans(
        sorted.map((s: any) => ({
          id: s.id,
          shipment_ref: s.shipment_ref,
          due_date: s.due_date,
          total_items: Number(s.total_items) || 0,
          total_expected_qty: Number(s.total_expected_qty) || 0,
          ready_item_count: Number(s.ready_item_count ?? s.ready_items) || 0,
          shipped_item_count: Number(s.shipped_item_count ?? s.shipped_items) || 0,
          created_by_name: s.created_by_name || null,
          created_at: s.created_at,
        }))
      );
    } catch {
      /* no-op */
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'summary') loadPendingPlans();
  }, [activeTab, refreshToken, loadPendingPlans]);

  useEffect(() => {
    if (activeTab !== 'summary') return;
    const interval = setInterval(() => loadPendingPlans(), 60_000);
    return () => clearInterval(interval);
  }, [activeTab, loadPendingPlans]);

  const handleDeletePlan = useCallback(
    async (planId: number) => {
      setDeleteLoading(true);
      try {
        const res = await fetch(`/api/fba/shipments/${planId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success || res.ok) {
          setPendingPlans((prev) => prev.filter((p) => p.id !== planId));
          if (activePlanId === planId) updateFbaParams({ plan: null });
        }
      } catch {
        /* no-op */
      } finally {
        setDeleteLoading(false);
        setDeletingPlanId(null);
      }
    },
    [activePlanId, updateFbaParams]
  );

  const handleDuplicateYesterday = useCallback(async () => {
    setDuplicating(true);
    try {
      const res = await fetch('/api/fba/shipments/today/duplicate-yesterday', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setDupToast(`Copied ${data.added} item${data.added !== 1 ? 's' : ''} from yesterday`);
        loadPendingPlans();
        window.dispatchEvent(new Event('fba-plan-created'));
        setTimeout(() => setDupToast(null), 3000);
      } else {
        setDupToast(data.error || 'Nothing to copy');
        setTimeout(() => setDupToast(null), 3000);
      }
    } catch {
      setDupToast('Failed to copy');
      setTimeout(() => setDupToast(null), 3000);
    } finally {
      setDuplicating(false);
    }
  }, [loadPendingPlans]);

  const handleCommitPlanQty = useCallback(
    async (plan: PendingPlan) => {
      const draft = planQtyDraft[plan.id];
      const qtyBase = plan.total_expected_qty > 0 ? plan.total_expected_qty : Math.max(1, plan.total_items);
      if (draft === undefined) return;
      const nextQty = Math.max(0, Math.floor(Number(draft) || 0));
      if (nextQty === qtyBase) {
        setPlanQtyDraft((d) => {
          const n = { ...d };
          delete n[plan.id];
          return n;
        });
        return;
      }
      if (plan.total_items !== 1 || plan.ready_item_count > 0) {
        setPlanQtyDraft((d) => {
          const n = { ...d };
          delete n[plan.id];
          return n;
        });
        return;
      }
      setQtySavingPlanId(plan.id);
      try {
        const itemsRes = await fetch(`/api/fba/shipments/${plan.id}/items`, { cache: 'no-store' });
        const itemsJson = await itemsRes.json();
        const items = Array.isArray(itemsJson?.items) ? itemsJson.items : [];
        if (items.length !== 1) return;
        const itemId = items[0].id;
        const patchRes = await fetch(`/api/fba/shipments/${plan.id}/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_qty: nextQty }),
        });
        if (patchRes.ok) {
          setPlanQtyDraft((d) => {
            const n = { ...d };
            delete n[plan.id];
            return n;
          });
          loadPendingPlans();
        }
      } catch {
        /* no-op */
      } finally {
        setQtySavingPlanId(null);
      }
    },
    [planQtyDraft, loadPendingPlans]
  );

  useEffect(() => {
    const h = () => loadPendingPlans();
    window.addEventListener('usav-refresh-data' as any, h as any);
    window.addEventListener('dashboard-refresh' as any, h as any);
    window.addEventListener('fba-plan-created' as any, h as any);
    window.addEventListener('fba-print-shipped' as any, h as any);
    return () => {
      window.removeEventListener('usav-refresh-data' as any, h as any);
      window.removeEventListener('dashboard-refresh' as any, h as any);
      window.removeEventListener('fba-plan-created' as any, h as any);
      window.removeEventListener('fba-print-shipped' as any, h as any);
    };
  }, [loadPendingPlans]);

  const plansByDay = useMemo(() => {
    const map = new Map<string, PendingPlan[]>();
    for (const p of pendingPlans) {
      const key = p.due_date ? String(p.due_date).slice(0, 10) : '__nodate__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === '__nodate__') return 1;
      if (b === '__nodate__') return -1;
      return a.localeCompare(b);
    });
    return keys.map((dayKey) => ({ dayKey, plans: map.get(dayKey)! }));
  }, [pendingPlans]);

  const planRefById = useMemo(() => {
    const map = new Map<number, string>();
    for (const plan of pendingPlans) {
      map.set(plan.id, plan.shipment_ref);
    }
    return map;
  }, [pendingPlans]);

  const summaryPlansListProps = {
    plansLoading,
    pendingPlans,
    plansByDay,
    dupToast,
    duplicating,
    onDuplicateYesterday: handleDuplicateYesterday,
    activePlanId,
    deletingPlanId,
    deleteLoading,
    onDeletePlan: handleDeletePlan,
    onClearDeleteIntent: () => setDeletingPlanId(null),
    onBeginDeletePlan: (id: number) => setDeletingPlanId(id),
    updateFbaParams,
    planQtyDraft,
    setPlanQtyDraft,
    qtySavingPlanId,
    onCommitPlanQty: handleCommitPlanQty,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className={`${fbaSidebarHeaderBand} px-3 py-3`}>
        <TabSwitch
          tabs={[
            { id: 'summary', label: 'Plan', color: 'gray' },
            { id: 'shipped', label: 'Shipped', color: 'gray' },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => updateFbaParams({ tab: tab as FbaTab })}
        />
      </div>

      <div className={`${fbaSidebarHeaderBand} flex items-center px-3 py-2.5`}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="FNSKU, ASIN, SKU, product…"
          variant="blue"
          className="w-full"
        />
      </div>

      {activeTab === 'summary' ? (
        <div className={`${fbaSidebarHeaderBand} px-3 py-3`}>
          <TabSwitch
            tabs={[
              { id: 'plan', label: 'Plan', color: 'purple' },
              { id: 'print', label: 'Print', color: 'purple' },
            ]}
            activeTab={summaryView}
            onTabChange={(tab) => {
              if (tab === 'print') {
                updateFbaParams({ tab: 'summary', mode: 'PRINT_READY' });
                return;
              }
              updateFbaParams({ tab: 'summary', mode: 'PLAN' });
            }}
          />
        </div>
      ) : null}

      {activeTab === 'summary' ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {summaryView === 'plan' && (
            <>
              <div className="w-full shrink-0 border-b border-gray-200 bg-white">
                <FbaFnskuPlanInput
                  variant="sidebar"
                  onCreated={(shipmentId, _shipmentRef) => {
                    updateFbaParams({
                      tab: 'summary',
                      plan: shipmentId,
                      mode: 'PLAN',
                      r: String(Date.now()),
                    });
                    window.dispatchEvent(new Event('fba-plan-created'));
                  }}
                  onClose={() => {
                    // Input stays mounted in plan mode; close only clears local step state.
                  }}
                />
              </div>
              <FbaAddToShipmentPanel
                shipmentOptions={pendingPlans.map((plan) => plan.id)}
                planRefById={planRefById}
                onAdded={loadPendingPlans}
              />
            </>
          )}
          {summaryView === 'print' && (
            <>
              <FbaPrintSidebarBlock planRefById={planRefById} />
              <FbaAddToShipmentPanel
                shipmentOptions={pendingPlans.map((plan) => plan.id)}
                planRefById={planRefById}
                onAdded={loadPendingPlans}
              />
            </>
          )}
          <div aria-label="Open plans" className="w-full shrink-0">
            <FbaSummaryPlansList {...summaryPlansListProps} />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] font-semibold text-gray-500">
              View shipped history and add UPS tracking numbers in the main panel →
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function FbaSidebarPanel() {
  return (
    <Suspense fallback={<FbaSidebarPanelFallback />}>
      <FbaSidebarPanelInner />
    </Suspense>
  );
}
