'use client';

/**
 * Mobile unit detail page — `/m/u/[id]`.
 *
 * Routed to from /m/scan via `routeScan()` whenever the operator scans a
 * unit DataMatrix (GS1 `(01)(21)`, `U-{id}` bare handle, or a Digital Link
 * URL). Until this page existed, /api/scan/resolve would silently drop unit
 * scans because the page wasn't built; that resolver was tightened in the
 * same change set so unmatched unit scans now route here.
 *
 * Two primary actions:
 *   1. Pair with order — POST /api/serial-units/[id]/allocate
 *   2. Move to location — POST /api/serial-units/[id]/move
 *
 * The page reads `mobile.scan.recent` localStorage and prefills the matching
 * action when the previous scan was an order (`Pair`) or a bin (`Move`),
 * so the common "scan order → scan unit" or "scan bin → scan unit" flows
 * are one tap from confirm. No prefill when context is ambiguous.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { unitStatusBadgeTone } from '@/components/station/receiving-constants';
import {
  ChevronLeft,
  Check,
  X,
  MapPin,
  ShoppingCart,
  History as HistoryIcon,
  AlertTriangle,
} from '@/components/Icons';
import { timeAgo } from '@/utils/_date';
import { Button, IconButton } from '@/design-system/primitives';

interface UnitDetail {
  id: number;
  serial_number: string;
  sku: string | null;
  product_title: string | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
}

interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  station: string | null;
  prev_status: string | null;
  next_status: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
  /** Actor display name, resolved by readTimeline's staff join. */
  actor_name?: string | null;
}

interface UnitResponse {
  success: boolean;
  serial_unit: UnitDetail;
  events: TimelineEvent[];
}

// Mirror of /m/scan's RecentScan — kept loose so we don't crash on shape drift.
interface ScanContext {
  raw: string;
  kind?: string;
  scannedAt: number;
  orders?: Array<{ order_id?: string | null; orderId?: string | null; id?: number | null }>;
}

const SCAN_CONTEXT_KEY = 'mobile.scan.recent';
const SCAN_CONTEXT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — the relevance horizon for prefill.

function readScanContext(): ScanContext[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SCAN_CONTEXT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pickContext(scans: ScanContext[]): {
  order: string | null;
  location: string | null;
} {
  const now = Date.now();
  let order: string | null = null;
  let location: string | null = null;
  for (const scan of scans) {
    if (!scan || typeof scan.scannedAt !== 'number') continue;
    if (now - scan.scannedAt > SCAN_CONTEXT_WINDOW_MS) break;
    // First match wins (most recent first).
    if (!order) {
      const firstOrder = Array.isArray(scan.orders) ? scan.orders[0] : null;
      const ref = firstOrder?.order_id ?? firstOrder?.orderId ?? null;
      if (ref) order = String(ref);
    }
    if (!location && (scan.kind === 'location' || scan.kind === 'bin')) {
      location = scan.raw;
    }
    if (order && location) break;
  }
  return { order, location };
}

export default function MobileUnitPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const rawParam = String(params?.id ?? '');
  const { user, isLoaded } = useAuth();

  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [orderInput, setOrderInput] = useState('');
  const [binInput, setBinInput] = useState('');
  const [busy, setBusy] = useState<'allocate' | 'move' | null>(null);
  const [activePanel, setActivePanel] = useState<'pair' | 'move' | null>(null);

  useEffect(() => {
    if (isLoaded && !user) router.replace(`/signin?next=/m/u/${rawParam}`);
  }, [isLoaded, user, router, rawParam]);

  const { data, isLoading, isError, error, refetch } = useQuery<UnitResponse>({
    queryKey: ['serial-unit.mobile', rawParam],
    enabled: !!rawParam,
    queryFn: async () => {
      const res = await fetch(`/api/serial-units/${encodeURIComponent(rawParam)}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      return json as UnitResponse;
    },
    refetchOnWindowFocus: false,
  });

  // Scan-context prefill — runs once on mount. Re-running on every render
  // would clobber the user's edits inside the open panels.
  useEffect(() => {
    const ctx = pickContext(readScanContext());
    if (ctx.order) {
      setOrderInput(ctx.order);
      setActivePanel((current) => current ?? 'pair');
    } else if (ctx.location) {
      setBinInput(ctx.location);
      setActivePanel((current) => current ?? 'move');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const submitPair = useCallback(
    async (transfer: boolean) => {
      const ref = orderInput.trim();
      if (!ref || busy) return;
      setBusy('allocate');
      try {
        const res = await fetch(
          `/api/serial-units/${encodeURIComponent(rawParam)}/allocate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              order_ref: ref,
              transfer,
              client_event_id: `mu-allocate-${rawParam}-${Date.now()}`,
            }),
          },
        );
        const json = await res.json();
        if (res.status === 409 && !transfer) {
          // Show the transfer confirm UI inline. The hint string from the
          // route is intentional — surfaces the reason the operator sees.
          setFlash({
            kind: 'err',
            msg: 'Already allocated — tap again to reassign.',
          });
          // Stash a flag on the input so a second submit transfers.
          (submitPair as unknown as { _transferReady?: boolean })._transferReady = true;
          return;
        }
        if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
        setFlash({ kind: 'ok', msg: `Paired with ${json.order_ref || json.order_id}` });
        setOrderInput('');
        setActivePanel(null);
        await refetch();
      } catch (err) {
        setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Pair failed' });
      } finally {
        setBusy(null);
      }
    },
    [orderInput, busy, rawParam, refetch],
  );

  const submitMove = useCallback(async () => {
    const bin = binInput.trim();
    if (!bin || busy) return;
    setBusy('move');
    try {
      const res = await fetch(`/api/serial-units/${encodeURIComponent(rawParam)}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bin_barcode: bin,
          bin_name: bin,
          client_event_id: `mu-move-${rawParam}-${Date.now()}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
      setFlash({ kind: 'ok', msg: `Moved to ${json.location?.name ?? bin}` });
      setBinInput('');
      setActivePanel(null);
      await refetch();
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Move failed' });
    } finally {
      setBusy(null);
    }
  }, [binInput, busy, rawParam, refetch]);

  if (!isLoaded || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-canvas text-label text-text-faint">
        Loading…
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-card text-caption text-text-faint">
        Loading unit…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-card px-6 text-center">
        <AlertTriangle className="mb-3 h-8 w-8 text-amber-400" />
        <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-amber-600">
          Couldn't load unit
        </p>
        <p className="mt-2 text-caption text-text-soft">
          {error instanceof Error ? error.message : 'Try scanning again.'}
        </p>
        <Button variant="secondary" onClick={() => router.back()} className="mt-6">
          Back
        </Button>
      </div>
    );
  }

  const unit = data.serial_unit;

  return (
    <div className="min-h-dvh bg-surface-canvas pb-10">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-hairline bg-surface-card px-3 py-3">
        <IconButton
          icon={<ChevronLeft className="h-5 w-5" />}
          onClick={() => router.back()}
          ariaLabel="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-surface-sunken"
        />
        <div className="min-w-0 flex-1">
          <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-faint">
            Unit
          </p>
          <p className="truncate font-mono text-label font-bold text-text-default">
            {unit.serial_number}
          </p>
        </div>
        <StatusPill status={unit.current_status} />
      </header>

      <main className="mx-auto w-full max-w-md space-y-3 px-3 pt-3">
        {/* Identity card */}
        <section className="rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60">
          {unit.product_title ? (
            <p className="line-clamp-3 text-sm font-semibold leading-snug text-text-default">
              {unit.product_title}
            </p>
          ) : (
            <p className="text-sm font-semibold text-text-faint">No product title</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {unit.sku ? (
              <span className="rounded bg-surface-sunken px-2 py-0.5 font-mono text-micro font-bold text-text-muted">
                {unit.sku}
              </span>
            ) : null}
            {unit.condition_grade ? (
              <span className="rounded bg-surface-sunken px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-text-muted">
                {unit.condition_grade.replace(/_/g, ' ')}
              </span>
            ) : null}
            {unit.current_location ? (
              <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-mono text-micro font-bold text-emerald-700">
                <MapPin className="h-3 w-3" />
                {unit.current_location}
              </span>
            ) : null}
          </div>
        </section>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <ActionButton
            label="Pair with order"
            icon={ShoppingCart}
            active={activePanel === 'pair'}
            onClick={() => setActivePanel(activePanel === 'pair' ? null : 'pair')}
          />
          <ActionButton
            label="Move to bin"
            icon={MapPin}
            active={activePanel === 'move'}
            onClick={() => setActivePanel(activePanel === 'move' ? null : 'move')}
          />
        </div>

        {/* Inline action panel — slides into place instead of opening a modal
            so the operator never loses sight of the unit card. */}
        {activePanel === 'pair' && (
          <ActionPanel
            heading="Pair with order"
            input={orderInput}
            setInput={setOrderInput}
            placeholder="Scan or type order id"
            primaryLabel={
              (submitPair as unknown as { _transferReady?: boolean })._transferReady
                ? 'Confirm reassign'
                : 'Pair'
            }
            busy={busy === 'allocate'}
            onSubmit={() =>
              submitPair(
                !!(submitPair as unknown as { _transferReady?: boolean })._transferReady,
              )
            }
            onCancel={() => {
              setActivePanel(null);
              setOrderInput('');
              (submitPair as unknown as { _transferReady?: boolean })._transferReady = false;
            }}
          />
        )}
        {activePanel === 'move' && (
          <ActionPanel
            heading="Move to bin"
            input={binInput}
            setInput={setBinInput}
            placeholder="Scan or type bin barcode"
            primaryLabel="Move"
            busy={busy === 'move'}
            onSubmit={submitMove}
            onCancel={() => {
              setActivePanel(null);
              setBinInput('');
            }}
          />
        )}

        {/* Compact timeline — newest first, capped to keep the page small. */}
        <Timeline events={data.events ?? []} />
      </main>

      {flash && (
        <div
          className={`fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-caption font-semibold shadow-lg ${
            flash.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
          }`}
        >
          {flash.msg}
        </div>
      )}
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function ActionButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  // ds-raw-button: two-state segmented toggle with custom active fill (blue-600)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-label font-bold shadow-sm transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-surface-card text-text-default ring-1 ring-border-soft hover:bg-surface-hover'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function ActionPanel({
  heading,
  input,
  setInput,
  placeholder,
  primaryLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  heading: string;
  input: string;
  setInput: (next: string) => void;
  placeholder: string;
  primaryLabel: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-soft">
          {heading}
        </p>
        <IconButton
          icon={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
          ariaLabel="Cancel"
          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-surface-sunken"
        />
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2.5 text-label font-mono text-text-default placeholder:text-text-faint focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={busy}
        disabled={busy || !input.trim()}
        icon={<Check />}
        className="mt-2 w-full"
      >
        {primaryLabel}
      </Button>
    </form>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)).slice(0, 25),
    [events],
  );
  return (
    <section className="rounded-2xl bg-surface-card shadow-sm ring-1 ring-border-soft/60">
      <header className="flex items-center gap-2 px-4 py-3">
        <HistoryIcon className="h-4 w-4 text-text-faint" />
        <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-soft">
          Timeline
        </p>
        <span className="ml-auto text-micro font-semibold text-text-faint">
          {sorted.length} {sorted.length === 1 ? 'event' : 'events'}
        </span>
      </header>
      {sorted.length === 0 ? (
        <div className="border-t border-border-hairline px-4 py-6 text-center text-caption font-medium text-text-faint">
          No events yet — pair an order or move into a bin to get started.
        </div>
      ) : (
        <ol className="border-t border-border-hairline divide-y divide-border-hairline">
          {sorted.map((e) => (
            <li key={e.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-label font-bold text-text-default">
                  {e.event_type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
                <span className="text-micro text-text-faint">{timeAgo(e.occurred_at)} ago</span>
                {e.actor_name ? (
                  <span className="text-micro font-medium text-text-soft">{e.actor_name}</span>
                ) : null}
                {e.station ? (
                  <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-text-soft">
                    {e.station}
                  </span>
                ) : null}
              </div>
              {e.prev_status && e.next_status && e.prev_status !== e.next_status ? (
                <p className="mt-0.5 font-mono text-micro text-text-soft">
                  {e.prev_status} → {e.next_status}
                </p>
              ) : null}
              {e.notes ? (
                <p className="mt-0.5 text-caption text-text-muted">{e.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'UNKNOWN').toUpperCase();
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-bold uppercase tracking-wide ${unitStatusBadgeTone(v)}`}
    >
      {v}
    </span>
  );
}
