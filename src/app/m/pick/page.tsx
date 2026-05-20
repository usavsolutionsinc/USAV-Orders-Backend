'use client';

/**
 * Mobile picker — `/m/pick`
 *
 * Phase B2.1 + picking API integration. Loads tasks from
 * `/api/orders/:id/pick-tasks`, opens a session via `/api/picking/session`,
 * and drives each action through the typed picking endpoints.
 *
 * Query params:
 *   ?order=<id>    order to pick (required)
 *
 * Design principles (see plan B0):
 *   - One thumb, one goal — primary action in the bottom dock.
 *   - Status before form — top strip shows order + progress + connection.
 *   - Multi-modal feedback — every confirm fires haptic + sound + visual.
 *   - Optimistic + reconciling — UI advances on tap; failures roll back with error feedback.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

import { useAuth } from '@/contexts/AuthContext';
import { useFeedback } from '@/hooks/useFeedback';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { MobileSettingsButton } from '@/components/mobile/MobileSettingsButton';
import { ProgressDots } from '@/components/mobile/ProgressDots';
import { ConfirmDock } from '@/components/mobile/ConfirmDock';
import { ScanSurface } from '@/components/mobile/ScanSurface';
import {
  ShortPickSheet,
  type ShortPickResult,
} from '@/components/mobile/picker/ShortPickSheet';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';

// ─── Types (mirror the picking API response) ─────────────────────────────────

interface PickTask {
  allocationId: number;
  serialUnitId: number;
  lineId: number;
  sku: string;
  productTitle: string | null;
  bin: string | null;
  conditionGrade: string | null;
  plannedQty: number;
  currentState: string;
}

interface PickOrder {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  shipByDate: string | null;
  tasks: PickTask[];
}

const CONDITION_TONE: Record<string, { label: string; chip: string }> = {
  BRAND_NEW: { label: 'New',    chip: 'bg-yellow-100  text-yellow-800  border-yellow-200' },
  USED_A:    { label: 'Used A', chip: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  USED_B:    { label: 'Used B', chip: 'bg-blue-100    text-blue-800    border-blue-200' },
  USED_C:    { label: 'Used C', chip: 'bg-slate-100   text-slate-800   border-slate-200' },
  PARTS:     { label: 'Parts',  chip: 'bg-amber-100   text-amber-800   border-amber-200' },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MobilePickerPage() {
  return (
    <Suspense fallback={<LoadingShell label="Loading picker…" />}>
      <PickerInner />
    </Suspense>
  );
}

function PickerInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderIdParam = searchParams?.get('order');
  const orderId = Number(orderIdParam);
  const { user, isLoaded } = useAuth();
  const feedback = useFeedback();
  const scanner = useBarcodeScanner();

  const [order, setOrder] = useState<PickOrder | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pickedAllocations, setPickedAllocations] = useState<Set<number>>(() => new Set());
  const [shortSheetOpen, setShortSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // ── Bounce to signin
  useEffect(() => {
    if (isLoaded && !user) {
      router.replace(`/signin?next=/m/pick${orderIdParam ? `?order=${orderIdParam}` : ''}`);
    }
  }, [isLoaded, user, router, orderIdParam]);

  // ── Camera lifecycle
  useEffect(() => {
    if (!user) return;
    void scanner.startScanning();
    return () => {
      void scanner.stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Bootstrap: fetch tasks + open session
  useEffect(() => {
    if (!user) return;
    if (!Number.isFinite(orderId) || orderId <= 0) {
      setLoadError('No order specified. Add ?order=<id> to the URL.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [tasksRes, sessionRes] = await Promise.all([
          fetch(`/api/orders/${orderId}/pick-tasks`, { cache: 'no-store' }),
          fetch('/api/picking/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId }),
          }),
        ]);
        if (!tasksRes.ok) throw new Error(`pick-tasks ${tasksRes.status}`);
        if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}`);
        const tasks = await tasksRes.json();
        const session = await sessionRes.json();
        if (cancelled) return;
        if (!tasks.ok) throw new Error(tasks.error || 'pick-tasks failed');
        if (!session.ok) throw new Error(session.error || 'session start failed');
        setOrder({
          orderId: tasks.orderId,
          orderLabel: tasks.orderLabel,
          customerInitials: tasks.customerInitials,
          shipByDate: tasks.shipByDate,
          tasks: tasks.tasks,
        });
        setSessionId(session.sessionId);
        // Skip already-PICKED rows when reopening a session.
        const firstOpen = tasks.tasks.findIndex(
          (t: PickTask) => t.currentState !== 'PICKED' && t.currentState !== 'PACKED' && t.currentState !== 'SHIPPED',
        );
        setCurrentIndex(firstOpen >= 0 ? firstOpen : tasks.tasks.length);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'load failed';
        setLoadError(message);
        feedback('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, orderId, feedback]);

  const currentTask = order?.tasks[currentIndex];
  const totalTasks = order?.tasks.length ?? 0;
  const doneCount = pickedAllocations.size;
  const allDone = totalTasks > 0 && doneCount >= totalTasks;

  const advance = useCallback(() => {
    if (!order) return;
    const next = order.tasks.findIndex(
      (t, i) => i > currentIndex && !pickedAllocations.has(t.allocationId),
    );
    setCurrentIndex(next >= 0 ? next : order.tasks.length);
    setDetailsExpanded(false);
  }, [order, currentIndex, pickedAllocations]);

  // ── Confirm pick (POST /api/picking/session/:id/confirm-pick)
  const handleConfirmPick = useCallback(async () => {
    if (!currentTask || sessionId == null) return;
    setConfirming(true);
    // Optimistic — mark done, advance, reconcile on rejection.
    const allocationId = currentTask.allocationId;
    setPickedAllocations((prev) => {
      const next = new Set(prev);
      next.add(allocationId);
      return next;
    });
    try {
      const res = await fetch(`/api/picking/session/${sessionId}/confirm-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocation_id: allocationId,
          client_event_id: `pick:${sessionId}:${allocationId}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `confirm-pick ${res.status}`);
      }
      feedback('success');
      // If this was the last open task, complete the session.
      const wasLast = currentIndex >= totalTasks - 1;
      if (wasLast) {
        await fetch(`/api/picking/session/${sessionId}/complete`, { method: 'POST' });
      } else {
        advance();
      }
    } catch (err) {
      // Roll back the optimistic mark.
      setPickedAllocations((prev) => {
        const next = new Set(prev);
        next.delete(allocationId);
        return next;
      });
      feedback('error');
      console.error('[m/pick] confirm-pick failed:', err);
    } finally {
      setConfirming(false);
    }
  }, [currentTask, sessionId, currentIndex, totalTasks, advance, feedback]);

  // ── Record short pick (POST /api/picking/session/:id/short-pick)
  const handleShortPick = useCallback(
    async (result: ShortPickResult) => {
      if (!currentTask || sessionId == null) return;
      const allocationId = currentTask.allocationId;
      // Optimistic mark.
      setPickedAllocations((prev) => {
        const next = new Set(prev);
        next.add(allocationId);
        return next;
      });
      try {
        const res = await fetch(`/api/picking/session/${sessionId}/short-pick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation_id: allocationId,
            picked_qty: result.pickedQty,
            planned_qty: result.plannedQty,
            reason: result.reason,
            note: result.note,
            client_event_id: `short:${sessionId}:${allocationId}`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `short-pick ${res.status}`);
        feedback('warning');
        advance();
      } catch (err) {
        setPickedAllocations((prev) => {
          const next = new Set(prev);
          next.delete(allocationId);
          return next;
        });
        feedback('error');
        console.error('[m/pick] short-pick failed:', err);
      }
    },
    [currentTask, sessionId, advance, feedback],
  );

  // ── Wire scanner decode → confirm.
  // Real-world implementation should verify the scanned value matches the
  // expected SKU/serial before calling confirm. For this scaffold any decode
  // advances the current task.
  const handleScanDecode = useCallback(
    (_value: string) => {
      if (!currentTask || confirming) return;
      void handleConfirmPick();
    },
    [currentTask, confirming, handleConfirmPick],
  );

  // ── Render gates
  if (!isLoaded || !user) return null;
  if (loadError) return <ErrorShell error={loadError} onBack={() => router.push('/packer')} />;
  if (!order) return <LoadingShell label="Loading tasks…" />;
  if (totalTasks === 0) return <EmptyShell onBack={() => router.push('/packer')} />;

  // ── Render
  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-50">
      {/* ─── Status strip ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-800">
              {order.customerInitials}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Order</p>
              <p className="truncate text-base font-bold text-slate-900">{order.orderLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ProgressDots done={doneCount} total={totalTasks} />
            <NetworkChip compact />
            <MobileSettingsButton />
          </div>
        </div>
      </header>

      {/* ─── Task content ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {allDone || !currentTask ? (
          <CompleteCard onBack={() => router.push('/packer')} />
        ) : (
          <AnimatePresence mode="wait">
            <motion.section
              key={currentTask.allocationId}
              initial={framerPresenceMobile.mobileCard.initial}
              animate={framerPresenceMobile.mobileCard.animate}
              exit={framerPresenceMobile.mobileCard.exit}
              transition={framerTransitionMobile.mobileCardMount}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              {/* Bin chip — the thing the worker looks for. */}
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pick from bin</p>
              <p className="mt-1 font-mono text-3xl font-extrabold tabular-nums tracking-tight text-blue-700">
                {currentTask.bin ?? '—'}
              </p>

              {/* Product title + qty + condition */}
              <div className="mt-4">
                <h2 className="text-base font-semibold leading-snug text-slate-900">
                  {currentTask.productTitle ?? currentTask.sku}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold tabular-nums text-slate-800">
                    Qty {currentTask.plannedQty}
                  </span>
                  {currentTask.conditionGrade && CONDITION_TONE[currentTask.conditionGrade] && (
                    <span
                      className={`inline-flex items-center rounded-xl border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                        CONDITION_TONE[currentTask.conditionGrade].chip
                      }`}
                    >
                      {CONDITION_TONE[currentTask.conditionGrade].label}
                    </span>
                  )}
                </div>
              </div>

              {/* Progressive disclosure */}
              <button
                type="button"
                onClick={() => {
                  feedback('selection');
                  setDetailsExpanded((v) => !v);
                }}
                className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-500 active:text-slate-700"
              >
                <span>{detailsExpanded ? 'Hide details' : 'Show details'}</span>
                <span aria-hidden="true">{detailsExpanded ? '▴' : '▾'}</span>
              </button>
              <AnimatePresence initial={false}>
                {detailsExpanded && (
                  <motion.dl
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="mt-2 grid grid-cols-2 gap-2 overflow-hidden text-xs"
                  >
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="font-semibold uppercase tracking-wider text-slate-500">SKU</dt>
                      <dd className="mt-0.5 font-mono font-bold text-slate-900">{currentTask.sku}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <dt className="font-semibold uppercase tracking-wider text-slate-500">Allocation</dt>
                      <dd className="mt-0.5 font-mono font-bold text-slate-900">#{currentTask.allocationId}</dd>
                    </div>
                  </motion.dl>
                )}
              </AnimatePresence>

              {/* Scanner */}
              <div className="mt-5">
                <ScanSurface
                  scanner={scanner}
                  onDecode={handleScanDecode}
                  manualPlaceholder="Type serial or SKU…"
                />
              </div>
            </motion.section>
          </AnimatePresence>
        )}
      </main>

      {/* ─── Bottom dock ───────────────────────────────────────────────── */}
      {!allDone && currentTask && (
        <ConfirmDock
          label={
            currentIndex >= totalTasks - 1
              ? `Confirm pick · ${doneCount + 1}/${totalTasks}`
              : 'Confirm pick'
          }
          onConfirm={() => void handleConfirmPick()}
          loading={confirming}
          tone={currentIndex >= totalTasks - 1 ? 'success' : 'primary'}
          secondary={{
            label: 'Short pick…',
            onPress: () => setShortSheetOpen(true),
          }}
        />
      )}

      {/* ─── Short pick sheet ─────────────────────────────────────────── */}
      {currentTask && (
        <ShortPickSheet
          open={shortSheetOpen}
          onClose={() => setShortSheetOpen(false)}
          pickedQty={0}
          plannedQty={currentTask.plannedQty}
          productLabel={`${currentTask.productTitle ?? currentTask.sku} · ${currentTask.sku}`}
          onConfirm={(r) => void handleShortPick(r)}
        />
      )}
    </div>
  );
}

// ─── Helper shells ───────────────────────────────────────────────────────────

function LoadingShell({ label }: { label: string }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-6 text-center">
      <div>
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{label}</p>
      </div>
    </div>
  );
}

function ErrorShell({ error, onBack }: { error: string; onBack: () => void }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-6 text-center">
      <div>
        <p className="text-base font-bold text-red-700">Could not load picker</p>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white active:bg-slate-800"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function EmptyShell({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-6 text-center">
      <div>
        <p className="text-base font-bold text-slate-700">Nothing to pick</p>
        <p className="mt-2 text-sm text-slate-500">All allocations for this order are already picked or shipped.</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white active:bg-slate-800"
        >
          Back to packer
        </button>
      </div>
    </div>
  );
}

function CompleteCard({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid place-items-center rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="mt-3 text-base font-bold text-emerald-900">Pick complete</p>
      <p className="mt-1 text-sm text-emerald-800/80">Cart is ready to hand off to the pack station.</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-5 rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white active:bg-emerald-800"
      >
        Back to packer
      </button>
    </div>
  );
}
