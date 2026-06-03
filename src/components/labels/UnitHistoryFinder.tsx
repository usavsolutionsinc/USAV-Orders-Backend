'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Clock } from '@/components/Icons';
import { routeScan } from '@/lib/barcode-routing';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';

const RECENTS_KEY = 'labels:history-recents:v1';
const MAX_RECENTS = 10;

interface RecentEntry {
  /** Lookup key passed to /api/serial-units/{key} — numeric id or serial. */
  key: string;
  /** Raw scanned value, kept so we can re-route if the schema changes later. */
  raw: string;
  at: number;
}

/**
 * Pull a serial_units lookup key out of an arbitrary scan. Returns null when
 * the scan clearly isn't a unit (a bin, a receiving carton, etc.) — the UI
 * surfaces that as a "not a unit" message instead of misdirecting the
 * operator. When `routeScan` doesn't know what to do (e.g. a typed raw
 * serial), we pass the value through unchanged because the API accepts
 * both numeric ids and serial_number strings.
 */
function extractUnitLookupKey(raw: string): { key: string; kind: 'unit' | 'unknown' } | null {
  const value = raw.trim();
  if (!value) return null;

  const route = routeScan(value);
  if (route?.type === 'serial-unit' && route.redirect) {
    // Two redirect shapes:  /01/{gtin}/21/{serial}  or  /m/u/{id}
    const m = /\/m\/u\/(\d+)$/.exec(route.redirect);
    if (m) return { key: m[1], kind: 'unit' };
    const g = /\/21\/([^/]+)$/.exec(route.redirect);
    if (g) return { key: decodeURIComponent(g[1]), kind: 'unit' };
  }
  if (route && route.type !== 'serial-unit') {
    // It's something — just not a unit. Refuse so we don't misdirect.
    return null;
  }
  // routeScan returned null (or didn't classify): try the raw value as a
  // serial_number / numeric id. The API resolves both.
  return { key: value, kind: 'unknown' };
}

function readRecents(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentEntry =>
          !!r && typeof r.key === 'string' && typeof r.raw === 'string' && typeof r.at === 'number',
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(next: RecentEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)));
  } catch {
    /* quota / private mode — ignore */
  }
}

/**
 * Sidebar component for the Labels → History sub-view. Owns:
 *   - localStorage recents (last 10 lookups)
 *   - the URL state `?historyId=<key>` that the workspace pane reads
 *
 * The scan/paste input lives in the sidebar's shared top SearchBar; on
 * Enter/scan it dispatches a `unit-history:lookup` event (raw value) that this
 * component resolves. USB DataMatrix scanners type + Enter, same as paste/type.
 */
export function UnitHistoryFinder() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentId = searchParams.get('historyId') || '';

  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    setRecents(readRecents());
  }, []);

  const setHistoryId = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key) params.set('historyId', key);
      else params.delete('historyId');
      const qs = params.toString();
      router.replace(qs ? `/products?${qs}` : '/products');
    },
    [router, searchParams],
  );

  const submit = useCallback(
    (raw: string) => {
      const resolved = extractUnitLookupKey(raw);
      if (!resolved) {
        setError("That doesn't look like a unit label — try scanning the small DataMatrix.");
        return;
      }
      setError(null);
      setHistoryId(resolved.key);

      // Persist to recents (dedup by key, newest first).
      setRecents((prev) => {
        const next = [
          { key: resolved.key, raw: raw.trim(), at: Date.now() },
          ...prev.filter((r) => r.key !== resolved.key),
        ].slice(0, MAX_RECENTS);
        writeRecents(next);
        return next;
      });
    },
    [setHistoryId],
  );

  // The scan/paste input now lives in the sidebar's top SearchBar; it fires a
  // `unit-history:lookup` event (raw value) on Enter/scan that we resolve here.
  useEffect(() => {
    const handler = (event: Event) => {
      const raw = (event as CustomEvent<{ raw?: string }>).detail?.raw;
      if (raw) submit(raw);
    };
    window.addEventListener('unit-history:lookup', handler as EventListener);
    return () => window.removeEventListener('unit-history:lookup', handler as EventListener);
  }, [submit]);

  const clearRecents = useCallback(() => {
    writeRecents([]);
    setRecents([]);
  }, []);

  const hasRecents = recents.length > 0;
  const recentsLabel = useMemo(() => (hasRecents ? `Recent (${recents.length})` : null), [
    hasRecents,
    recents.length,
  ]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Scan/paste input lives in the sidebar's top SearchBar now; we only
          surface lookup errors here. */}
      {error && (
        <div className={`shrink-0 border-b border-gray-100 bg-amber-50 ${SIDEBAR_GUTTER} py-2`}>
          <p className="text-micro font-semibold text-amber-700">{error}</p>
        </div>
      )}

      {/* Body — recents list. Each row jumps the workspace to that unit. */}
      <div className="flex-1 overflow-y-auto">
        {!hasRecents ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
            <Clock className="mb-3 h-8 w-8 text-gray-300" />
            <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
              No history yet
            </p>
            <p className="mt-2 max-w-[240px] text-caption font-medium text-gray-500">
              Scan a unit's DataMatrix above — its full timeline appears in the workspace.
            </p>
          </div>
        ) : (
          <>
            <div className={`flex items-center justify-between bg-gray-50 ${SIDEBAR_GUTTER} py-1.5`}>
              <span className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-500">
                {recentsLabel}
              </span>
              <button
                type="button"
                onClick={clearRecents}
                className="text-micro font-semibold text-gray-400 transition-colors hover:text-gray-600"
              >
                Clear
              </button>
            </div>
            <ul className="divide-y divide-gray-100">
              {recents.map((r) => (
                <li key={`${r.key}-${r.at}`}>
                  <button
                    type="button"
                    onClick={() => setHistoryId(r.key)}
                    className={`flex w-full items-center gap-3 ${SIDEBAR_GUTTER} py-2 text-left transition-colors hover:bg-blue-50 ${
                      currentId === r.key ? 'bg-blue-50' : ''
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-caption font-semibold text-gray-900">
                        {r.key}
                      </span>
                      <span className="truncate text-micro text-gray-400">{r.raw}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
