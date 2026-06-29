'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { Search } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SidebarListPicker } from './SidebarListPicker';
import { TRACE_RECENTS_KEY, type ListRow } from './audit-log-panel-shared';

/**
 * First-Trace sidebar: the shared search box is the serial input (Enter / the
 * Trace button submits it into `?serial=`). Below it, the recently-traced
 * serials (client-only, localStorage) for one-tap re-trace. The active serial
 * is highlighted. Reuses {@link SidebarListPicker} for the recents list.
 */
export function TraceSerialPicker({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get('serial');
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRACE_RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw) as string[]);
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Mirror the active serial into the recents list (most-recent first, capped).
  useEffect(() => {
    const s = selected?.trim();
    if (!s) return;
    setRecents((prev) => {
      const next = [s, ...prev.filter((x) => x.toUpperCase() !== s.toUpperCase())].slice(0, 12);
      try {
        window.localStorage.setItem(TRACE_RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [selected]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('serial', v);
    router.replace(`/audit-log/trace?${params.toString()}`);
  };

  const trimmed = query.trim();
  const recentRows: ListRow[] = recents.map((s) => ({ key: s, title: s }));

  return (
    <div className="flex h-full flex-col">
      <div className={`${SIDEBAR_GUTTER} py-3`}>
        <Button
          type="button"
          size="sm"
          icon={<Search />}
          onClick={() => submit(trimmed)}
          disabled={!trimmed}
          className="w-full bg-emerald-600 text-white enabled:hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {trimmed ? `Trace "${trimmed}"` : 'Type a serial above to trace'}
        </Button>
      </div>
      {recents.length > 0 ? (
        <>
          <p className={`${SIDEBAR_GUTTER} pb-1 text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400`}>
            Recently traced
          </p>
          <div className="min-h-0 flex-1">
            <SidebarListPicker
              rows={recentRows}
              selectedKey={selected}
              onSelect={submit}
              loading={false}
              error={null}
            />
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center text-caption text-gray-400">
          Scan or type a serial above, then press Trace.
        </div>
      )}
    </div>
  );
}
