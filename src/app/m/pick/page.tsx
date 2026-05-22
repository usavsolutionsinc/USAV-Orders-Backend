'use client';

/**
 * Mobile picker queue — `/m/pick`
 *
 * Landing page for the picker workflow. Lists every order with at least
 * one open allocation (state ALLOCATED or PICKING) sorted by ship deadline.
 *
 * Tapping a card navigates to `/m/pick/[orderId]` which runs the
 * order-specific picker.
 *
 * Legacy redirect: `/m/pick?order=N` (old query-param form) → `/m/pick/N`.
 *
 * Data source: GET /api/pick/queue (gated by INVENTORY_V2_PICKING).
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';
import { useFeedback } from '@/hooks/useFeedback';
import { NetworkChip } from '@/components/mobile/NetworkChip';
import { MobileSettingsButton } from '@/components/mobile/MobileSettingsButton';

interface QueueRow {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  customerName: string | null;
  accountSource: string | null;
  shipByDate: string | null;
  pendingCount: number;
  inProgressCount: number;
  totalCount: number;
  activePickerId: number | null;
}

const REFRESH_INTERVAL_MS = 30_000;

export default function MobilePickQueuePage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <QueueInner />
    </Suspense>
  );
}

function QueueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyOrder = searchParams?.get('order');
  const { user, isLoaded } = useAuth();
  const staffId = user?.staffId ?? null;
  const feedback = useFeedback();

  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Legacy redirect: /m/pick?order=N → /m/pick/N
  useEffect(() => {
    if (legacyOrder && /^\d+$/.test(legacyOrder)) {
      router.replace(`/m/pick/${legacyOrder}`);
    }
  }, [legacyOrder, router]);

  // ── Bounce to signin
  useEffect(() => {
    if (isLoaded && !user) {
      router.replace('/signin?next=/m/pick');
    }
  }, [isLoaded, user, router]);

  const loadQueue = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/pick/queue', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `queue ${res.status}`);
      setQueue(data.queue as QueueRow[]);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'queue load failed';
      setLoadError(message);
      feedback('error');
    } finally {
      setRefreshing(false);
    }
  }, [feedback]);

  // ── Initial load + polling
  useEffect(() => {
    if (!user) return;
    void loadQueue();
    const iv = setInterval(() => void loadQueue(), REFRESH_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [user, loadQueue]);

  const handleOpen = useCallback(
    (orderId: number) => {
      feedback('selection');
      router.push(`/m/pick/${orderId}`);
    },
    [router, feedback],
  );

  if (!isLoaded || !user) return null;

  return (
    // min-h-full so this page fits inside the /m layout's scroll container
    // (which is already 100dvh minus the bottom nav). Avoids the
    // double-100dvh nested-scroll problem.
    <div className="flex min-h-full flex-col bg-slate-50">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Picker</p>
            <p className="text-base font-bold text-slate-900">Pick queue</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadQueue()}
              disabled={refreshing}
              className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-700 active:bg-slate-200 disabled:opacity-50"
              aria-label="Refresh queue"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v6h6M20 20v-6h-6M5.07 9A8 8 0 0 1 18.36 6.64L20 8M3.64 16l1.64-1.36A8 8 0 0 0 18.93 15"
                />
              </svg>
            </button>
            <NetworkChip compact />
            <MobileSettingsButton />
          </div>
        </div>
      </header>

      {/* ─── Body ───────────────────────────────────────────────────────── */}
      {/* Scrolling is owned by the parent /m layout container, so no
          overflow-y-auto here — having two nested scroll contexts breaks
          sticky positioning and momentum scroll on iOS. */}
      <main className="flex-1 px-4 pt-4 pb-8">
        {loadError && !queue ? (
          <ErrorCard error={loadError} onRetry={() => void loadQueue()} />
        ) : queue === null ? (
          <QueueSkeleton />
        ) : queue.length === 0 ? (
          <EmptyCard />
        ) : (
          <ul className="space-y-3">
            {queue.map((row) => (
              <li key={row.orderId}>
                <QueueCard
                  row={row}
                  claimedByMe={row.activePickerId != null && row.activePickerId === staffId}
                  onOpen={() => handleOpen(row.orderId)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function QueueCard({
  row,
  claimedByMe,
  onOpen,
}: {
  row: QueueRow;
  claimedByMe: boolean;
  onOpen: () => void;
}) {
  const claimedByOther = row.activePickerId != null && !claimedByMe;
  const deadline = formatDeadline(row.shipByDate);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] active:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-100 text-base font-bold text-blue-800">
          {row.customerInitials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-base font-bold text-slate-900">{row.orderLabel}</p>
            {row.accountSource && (
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {row.accountSource}
              </span>
            )}
          </div>
          {row.customerName && (
            <p className="truncate text-sm text-slate-500">{row.customerName}</p>
          )}
        </div>
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold tabular-nums text-slate-800">
          {row.totalCount} {row.totalCount === 1 ? 'unit' : 'units'}
        </span>
        {row.inProgressCount > 0 && (
          <span className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
            {row.inProgressCount} in progress
          </span>
        )}
        {deadline && (
          <span
            className={`inline-flex items-center rounded-xl border px-2.5 py-1 text-xs font-semibold ${
              deadline.overdue
                ? 'border-red-200 bg-red-50 text-red-700'
                : deadline.soon
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-700'
            }`}
          >
            {deadline.label}
          </span>
        )}
        {claimedByMe && (
          <span className="inline-flex items-center rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
            You · resume
          </span>
        )}
        {claimedByOther && (
          <span className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            In use by #{row.activePickerId}
          </span>
        )}
      </div>
    </button>
  );
}

function QueueSkeleton() {
  return (
    <ul className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </ul>
  );
}

function EmptyCard() {
  return (
    <div className="grid place-items-center rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-500">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="mt-3 text-base font-bold text-slate-700">Queue is empty</p>
      <p className="mt-1 text-sm text-slate-500">No orders are waiting to be picked right now.</p>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="grid place-items-center rounded-3xl border border-red-200 bg-red-50 px-6 py-12 text-center">
      <p className="text-base font-bold text-red-800">Could not load queue</p>
      <p className="mt-2 text-sm text-red-700">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded-2xl bg-red-700 px-5 py-2.5 text-sm font-semibold text-white active:bg-red-800"
      >
        Retry
      </button>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="grid min-h-full place-items-center bg-slate-50 px-6 py-10 text-center">
      <div>
        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="mt-3 text-sm font-semibold text-slate-600">Loading…</p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDeadline(iso: string | null): { label: string; soon: boolean; overdue: boolean } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  const diffMs = t - now;
  const diffHrs = diffMs / (1000 * 60 * 60);
  const overdue = diffMs < 0;
  const soon = !overdue && diffHrs < 12;
  let label: string;
  if (overdue) {
    const ago = Math.abs(diffHrs);
    label = ago < 24 ? `Overdue · ${Math.round(ago)}h` : `Overdue · ${Math.round(ago / 24)}d`;
  } else if (diffHrs < 1) {
    label = 'Due <1h';
  } else if (diffHrs < 24) {
    label = `Due ${Math.round(diffHrs)}h`;
  } else {
    label = `Due ${Math.round(diffHrs / 24)}d`;
  }
  return { label, soon, overdue };
}
