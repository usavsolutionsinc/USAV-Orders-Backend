'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Trash2, X, Copy } from '@/components/Icons';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';

type FbaTab = 'summary' | 'shipped';

function dueDateLabel(due: string | null): { text: string; cls: string } {
  if (!due) return { text: 'No date', cls: 'text-zinc-400' };
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: 'text-red-600 font-black' };
  if (days === 0) return { text: 'Due today', cls: 'text-amber-600 font-black' };
  if (days === 1) return { text: 'Due tomorrow', cls: 'text-amber-500 font-bold' };
  return { text: `${days} days`, cls: 'text-zinc-500' };
}

function formatPlanDayHeader(dayKey: string): string {
  if (dayKey === '__nodate__') return 'No due date';
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

interface PendingPlan {
  id: number;
  shipment_ref: string;
  due_date: string | null;
  total_items: number;
  total_expected_qty: number;
  ready_item_count: number;
  shipped_item_count: number;
  created_by_name: string | null;
  created_at: string;
}

function FbaSidebarPanelFallback() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}><div className="h-9 w-full rounded-xl bg-zinc-100" /></div>
      <div className={`${sidebarHeaderBandClass} flex h-11 items-center px-3`}><div className="h-8 w-full rounded bg-zinc-100" /></div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white" />
    </div>
  );
}

function FbaSidebarPanelInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab: FbaTab = searchParams.get('tab') === 'shipped' ? 'shipped' : 'summary';
  const activePlanId = searchParams.get('plan') ? Number(searchParams.get('plan')) : null;

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <TabSwitch
          tabs={[
            { id: 'summary', label: 'Plan', color: 'gray' },
            { id: 'shipped', label: 'Shipped', color: 'gray' },
          ]}
          activeTab={activeTab}
          onTabChange={(tab) => updateFbaParams({ tab: tab as FbaTab })}
        />
      </div>

      <div className={`${sidebarHeaderBandClass} flex h-11 items-center px-3`}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="FNSKU, ASIN, SKU, product…"
          variant="blue"
          className="w-full"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'summary' && (
          <div className="flex flex-col">
            {plansLoading && pendingPlans.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
              </div>
            ) : !plansLoading && pendingPlans.length === 0 ? (
              <p className="py-10 text-center text-[9px] font-semibold italic text-zinc-300">No open plans</p>
            ) : (
              plansByDay.map(({ dayKey, plans }, gi) => (
                <div key={dayKey}>
                  <div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-50/95 px-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
                      {formatPlanDayHeader(dayKey)}
                    </span>
                    {gi === 0 ? (
                      <div className="flex items-center gap-2">
                        <AnimatePresence>
                          {dupToast && (
                            <motion.span
                              key="dup-toast"
                              initial={{ opacity: 0, x: 8 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              className="text-[8px] font-semibold italic text-emerald-600"
                            >
                              {dupToast}
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.88 }}
                          disabled={duplicating}
                          onClick={handleDuplicateYesterday}
                          title="Copy yesterday's plan to today"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 transition-colors hover:border-violet-300 hover:text-violet-600 disabled:opacity-40"
                        >
                          {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                        </motion.button>
                      </div>
                    ) : null}
                  </div>
                  <AnimatePresence initial={false}>
                    {plans.map((plan, i) => {
                      const due = dueDateLabel(plan.due_date);
                      const isActive = activePlanId === plan.id;
                      const isConfirmDelete = deletingPlanId === plan.id;
                      const qtyBase = plan.total_expected_qty > 0 ? plan.total_expected_qty : Math.max(1, plan.total_items);
                      const canEditQty = plan.total_items === 1 && plan.ready_item_count === 0;
                      return (
                        <motion.div
                          key={plan.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -16, scale: 0.96 }}
                          transition={{ duration: 0.18, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                          className={`flex items-stretch border-b border-zinc-100 ${isActive ? 'bg-violet-50' : 'bg-white'}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingPlanId(null);
                              updateFbaParams({ plan: isActive ? null : plan.id, tab: 'summary' });
                            }}
                            className={`min-w-0 flex-1 px-3 py-2 text-left transition-colors ${isActive ? '' : 'hover:bg-zinc-50'}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-black text-zinc-900">
                                  {plan.shipment_ref}
                                </span>
                                {plan.due_date && new Date(plan.due_date) < new Date(Date.now() - 2 * 86400000) && (
                                  <span
                                    className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-700"
                                    title="Plan is overdue"
                                  >
                                    ⚠
                                  </span>
                                )}
                              </div>
                              {isActive && (
                                <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-700">
                                  Open
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span className={`text-[9px] ${due.cls}`}>{due.text}</span>
                              <span className="text-[9px] text-zinc-400">·</span>
                              <span className="text-[9px] tabular-nums text-zinc-400">
                                {plan.total_items} line{plan.total_items !== 1 ? 's' : ''}
                              </span>
                              {plan.ready_item_count > 0 && (
                                <>
                                  <span className="text-[9px] text-zinc-400">·</span>
                                  <span className="text-[9px] tabular-nums text-emerald-600">{plan.ready_item_count} ready</span>
                                </>
                              )}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">Qty</span>
                              {canEditQty ? (
                                <input
                                  type="number"
                                  min={0}
                                  disabled={qtySavingPlanId === plan.id}
                                  value={planQtyDraft[plan.id] ?? String(qtyBase)}
                                  onChange={(e) => setPlanQtyDraft((d) => ({ ...d, [plan.id]: e.target.value }))}
                                  onBlur={() => void handleCommitPlanQty(plan)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-14 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-center text-[10px] font-black tabular-nums text-zinc-900 outline-none focus:border-violet-400"
                                />
                              ) : (
                                <span
                                  className="text-[10px] font-black tabular-nums text-zinc-700"
                                  title={
                                    plan.total_items !== 1 ? 'Open plan to edit multiple lines' : 'Progress locked qty'
                                  }
                                >
                                  {qtyBase}
                                </span>
                              )}
                              {qtySavingPlanId === plan.id ? (
                                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                              ) : null}
                            </div>
                            {plan.total_items > 0 && (
                              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${Math.round((plan.ready_item_count / plan.total_items) * 100)}%`,
                                  }}
                                  transition={{ duration: 0.5, ease: 'easeOut' }}
                                  className="h-full rounded-full bg-emerald-400"
                                />
                              </div>
                            )}
                          </button>
                          <AnimatePresence mode="wait" initial={false}>
                            {isConfirmDelete ? (
                              <motion.div
                                key="confirm"
                                initial={{ opacity: 0, width: 0 }}
                                animate={{ opacity: 1, width: 'auto' }}
                                exit={{ opacity: 0, width: 0 }}
                                className="flex items-center gap-0.5 overflow-hidden border-l border-zinc-100 px-1.5"
                              >
                                <button
                                  type="button"
                                  disabled={deleteLoading}
                                  onClick={() => handleDeletePlan(plan.id)}
                                  className="flex h-6 items-center gap-1 rounded bg-red-500 px-2 text-[9px] font-black uppercase tracking-wide text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                                >
                                  {deleteLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Del'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingPlanId(null)}
                                  className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:text-zinc-600"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </motion.div>
                            ) : (
                              <motion.button
                                key="trash"
                                type="button"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingPlanId(plan.id);
                                }}
                                className="border-l border-zinc-100 px-3 text-zinc-200 transition-colors hover:text-red-400"
                                aria-label="Delete plan"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </motion.button>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'shipped' && (
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] font-semibold text-zinc-400">
              View shipped history and add UPS tracking numbers in the main panel →
            </p>
          </div>
        )}
      </div>
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
