'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from '@/components/Icons';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import {
  readSelectLineDetail,
  type ReceivingSelectLineDetail,
} from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { TestingPanel } from '@/components/tech/TestingPanel';

interface Props {
  staffId: string;
  /** When set, drives the rail-side highlighted line. */
  selectedLineId: number | null;
  onSelectedLineChange: (id: number | null) => void;
}

const LAST_TESTING_LINE_KEY = 'usav:testing:last-line-id';

export function TestingLineWorkspace({ staffId, selectedLineId, onSelectedLineChange }: Props) {
  const [row, setRow] = useState<ReceivingLineRow | null>(null);
  const [restoring, setRestoring] = useState(true);
  const lastSelectedRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ReceivingSelectLineDetail>).detail;
      const { row: next } = readSelectLineDetail(detail);
      if (next) {
        setRow(next);
        setRestoring(false);
        onSelectedLineChange(next.id);
        lastSelectedRef.current = next.id;
        try {
          window.localStorage.setItem(LAST_TESTING_LINE_KEY, String(next.id));
        } catch {
          /* private mode / quota — non-fatal */
        }
      } else {
        setRow(null);
        onSelectedLineChange(null);
        lastSelectedRef.current = null;
      }
    };
    window.addEventListener('receiving-select-line', handler);
    return () => window.removeEventListener('receiving-select-line', handler);
  }, [onSelectedLineChange]);

  const rowRef = useRef<ReceivingLineRow | null>(null);
  rowRef.current = row;
  useEffect(() => {
    let cancelled = false;

    const fetchById = async (id: number): Promise<ReceivingLineRow | null> => {
      try {
        const res = await fetch(`/api/receiving-lines?id=${id}&include=serials`, { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (data?.success && data.receiving_line) return data.receiving_line as ReceivingLineRow;
        return null;
      } catch {
        return null;
      }
    };

    const fetchMostRecent = async (): Promise<ReceivingLineRow | null> => {
      try {
        const res = await fetch(
          `/api/receiving-lines?limit=1&offset=0&view=all&include=serials`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        const rows = Array.isArray(data?.receiving_lines)
          ? (data.receiving_lines as ReceivingLineRow[])
          : [];
        return rows[0] ?? null;
      } catch {
        return null;
      }
    };

    void (async () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(LAST_TESTING_LINE_KEY);
      } catch {
        /* private mode — fall through to recent */
      }
      const storedId = Number(stored);
      if (Number.isFinite(storedId) && storedId > 0) {
        const restored = await fetchById(storedId);
        if (cancelled) return;
        if (restored) {
          if (rowRef.current) {
            setRestoring(false);
            return;
          }
          dispatchSelectLine(restored);
          setRestoring(false);
          return;
        }
        try {
          window.localStorage.removeItem(LAST_TESTING_LINE_KEY);
        } catch {
          /* non-fatal */
        }
      }
      if (cancelled || rowRef.current) {
        setRestoring(false);
        return;
      }
      const recent = await fetchMostRecent();
      if (cancelled) {
        setRestoring(false);
        return;
      }
      if (recent && !rowRef.current) {
        dispatchSelectLine(recent);
      }
      setRestoring(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const patch = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!patch || typeof patch.id !== 'number') return;
      setRow((current) =>
        current && current.id === patch.id
          ? ({ ...current, ...patch } as ReceivingLineRow)
          : current,
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  if (restoring && !row) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-canvas">
        <Loader2 className="h-6 w-6 animate-spin text-text-faint" aria-hidden />
        <p className="text-caption font-bold uppercase tracking-widest text-text-faint">
          Loading testing workspace…
        </p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-canvas px-6 text-center">
        <p className="text-sm font-bold text-text-muted">No line selected</p>
        <p className="max-w-sm text-caption text-text-soft">
          Scan a unit or PO from the sidebar, or pick a line from the testing rail to begin.
        </p>
      </div>
    );
  }

  return <TestingPanel key={row.id} row={row} staffId={staffId} />;
}
