'use client';

/**
 * Sidebar toolbar for the Unfound queue.
 *
 * Renders the filter pills (kind), search box, and Refresh button. Writes
 * filter state to URL search params (uf_kind, uf_q) so UnfoundQueueTable —
 * which reads the same params — stays in lockstep without a shared store.
 *
 * The 'Checked' pill is a pseudo-kind: server-side the table translates it
 * to kind=all + checked=true. All other pills hide checked rows.
 *
 * Refresh dispatches a `unfound-queue-refresh` window event the table
 * listens for. Keeps the toolbar decoupled from the table's fetch hook.
 */

import { useCallback, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Mail, RefreshCw, Search } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { toast } from '@/lib/toast';
import {
  ENABLED_KINDS,
  KIND_LABELS,
  type QueueKind,
} from '@/components/receiving/unfound/UnfoundQueueTable';

const UNFOUND_QUEUE_REFRESH_EVENT = 'unfound-queue-refresh';
const SEARCH_DEBOUNCE_MS = 300;

function parseKind(raw: string | null): QueueKind {
  if (!raw) return 'all';
  return (ENABLED_KINDS as readonly string[]).includes(raw)
    ? (raw as QueueKind)
    : 'all';
}

export function UnfoundQueueSidebarToolbar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Stay on the current route (now Admin › PO Mailbox) when writing filter
  // params — `next` already carries the other params (e.g. ?section=), so we
  // only swap the pathname-hardcode for the live one.
  const pathname = usePathname();

  const kind = parseKind(searchParams.get('uf_kind'));
  const q = searchParams.get('uf_q') ?? '';

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanning, setScanning] = useState(false);
  // How many emails to pull on the next scan. Persisted to localStorage so
  // an operator who picks "100" doesn't keep re-selecting it every visit.
  // Endpoint caps at 200 (see reconcile/route.ts:MAX_LIMIT).
  const [scanLimit, setScanLimit] = useState<number>(() => {
    if (typeof window === 'undefined') return 25;
    const stored = Number(window.localStorage.getItem('unfoundQueue.scanLimit'));
    return Number.isFinite(stored) && stored >= 10 && stored <= 200 ? stored : 25;
  });
  const onScanLimitChange = useCallback((next: number) => {
    setScanLimit(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('unfoundQueue.scanLimit', String(next));
    }
  }, []);

  // Write a single param (or delete it when empty). All three filters live
  // under `uf_*` so they don't collide with the receiving page's own params.
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, searchParams, pathname],
  );

  const onKind = useCallback(
    (next: QueueKind) => setParam('uf_kind', next === 'all' ? null : next),
    [setParam],
  );

  const onSearch = useCallback(
    (raw: string) => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      // Debounce so we don't push a new history entry on every keystroke.
      searchDebounceRef.current = setTimeout(() => {
        setParam('uf_q', raw.trim() || null);
      }, SEARCH_DEBOUNCE_MS);
    },
    [setParam],
  );

  const onRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent(UNFOUND_QUEUE_REFRESH_EVENT));
  }, []);

  // "Scan emails" — fires the PO Mailbox reconcile pipeline: pulls fresh
  // Gmail messages, extracts PO #s, diffs against the Zoho mirror, and
  // upserts unmatched ones into email_missing_purchase_orders. Then refreshes
  // the queue so any newly-landed mailbox rows show up immediately.
  //
  // Distinct from Refresh (which only re-queries the local view) — this
  // actually goes out to Gmail and ingests new emails.
  const onScanEmails = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    const loadingId = toast.loading(
      `Scanning last ${scanLimit} Gmail message${scanLimit === 1 ? '' : 's'}…`,
    );
    try {
      const url = new URL(
        '/api/admin/po-gmail/reconcile',
        window.location.origin,
      );
      url.searchParams.set('limit', String(scanLimit));
      const res = await fetch(url.toString(), {
        method: 'GET',
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        items?: unknown[];
        persisted?: { upserted?: number; resolved?: number } | null;
        elapsedMs?: number;
      };
      if (res.status === 401 || res.status === 403) {
        throw new Error('Scan emails requires admin permission');
      }
      if (!res.ok) {
        throw new Error(body.error ?? `scan failed (${res.status})`);
      }
      const scanned = Array.isArray(body.items) ? body.items.length : 0;
      const upserted = body.persisted?.upserted ?? 0;
      const resolved = body.persisted?.resolved ?? 0;
      toast.dismiss(loadingId);
      toast.success(
        `Scanned ${scanned} email${scanned === 1 ? '' : 's'} · ${upserted} new · ${resolved} resolved`,
      );
      // Pull the freshly-persisted rows into the table.
      window.dispatchEvent(new CustomEvent(UNFOUND_QUEUE_REFRESH_EVENT));
    } catch (err) {
      toast.dismiss(loadingId);
      toast.error(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }, [scanning, scanLimit]);

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Title + actions */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight text-gray-900">
          Unfound queue
        </h2>
        <HoverTooltip
          label="Refresh the queue from the local DB (no Gmail call)"
          asChild
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw />}
            onClick={onRefresh}
            ariaLabel="Refresh the queue from the local DB (no Gmail call)"
            className="gap-1 rounded-md border border-gray-200 px-2 py-1 text-micro font-bold uppercase tracking-wider text-gray-600 hover:bg-gray-50"
          >
            Refresh
          </Button>
        </HoverTooltip>
      </div>

      {/* Scan-emails row: depth selector + button. Last-N picker lives next
          to the action so the operator sees exactly how far back they're
          about to look. localStorage-persisted (key: unfoundQueue.scanLimit). */}
      <div className="flex items-center gap-2">
        <HoverTooltip
          label={`Pull the last ${scanLimit} Gmail messages and reconcile against Zoho`}
          asChild
        >
          <Button
            variant="ghost"
            size="sm"
            icon={<Mail className={scanning ? 'animate-pulse' : undefined} />}
            onClick={() => void onScanEmails()}
            disabled={scanning}
            ariaLabel={`Pull the last ${scanLimit} Gmail messages and reconcile against Zoho`}
            className="flex-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-micro font-bold uppercase tracking-wider text-blue-700 hover:bg-blue-100"
          >
            {scanning ? 'Scanning…' : `Scan last ${scanLimit}`}
          </Button>
        </HoverTooltip>
        <label className="sr-only" htmlFor="unfound-scan-limit">
          Scan depth
        </label>
        <HoverTooltip
          label="How many recent Gmail messages to fetch on each scan"
          asChild
        >
          <select
            id="unfound-scan-limit"
            value={scanLimit}
            onChange={(e) => onScanLimitChange(Number(e.target.value))}
            disabled={scanning}
            aria-label="How many recent Gmail messages to fetch on each scan"
            className="h-7 rounded-md border border-gray-200 bg-white px-1.5 text-micro font-bold tracking-wider text-gray-700 outline-none focus:border-blue-500 disabled:opacity-60"
          >
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </HoverTooltip>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title, serial, note, ticket…"
          className="h-8 w-full rounded-md border border-gray-200 bg-white pl-7 pr-3 text-label outline-none focus:border-blue-500"
        />
      </div>

      {/* Kind filter pills — stacked one per row to fit the narrow sidebar.
          'Checked' is its own pill (not a separate toggle) so the operator
          flips between work-to-do and completed work the same way they flip
          between sources. */}
      <div className="flex flex-col gap-1">
        <p className="text-micro font-bold uppercase tracking-wider text-gray-400">
          Source
        </p>
        {ENABLED_KINDS.map((k) => (
          <Button
            key={k}
            variant={kind === k ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onKind(k)}
            className={`justify-start rounded-md px-2.5 py-1.5 text-left text-label font-semibold ${
              kind === k
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            {KIND_LABELS[k]}
          </Button>
        ))}
      </div>
    </div>
  );
}
