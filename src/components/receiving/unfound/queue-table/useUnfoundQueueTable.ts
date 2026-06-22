'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from '@/lib/toast';
import {
  DEBOUNCE_MS,
  UNFOUND_QUEUE_REFRESH_EVENT,
  parseKind,
  type PatchBody,
  type QueueResponse,
  type QueueRow,
} from './unfound-queue-shared';

/**
 * Owns the unfound-queue table's data + mutations: URL-param filter state
 * (kind/search are the source of truth), the abortable/debounced fetch +
 * sidebar-refresh-event wiring, the inline-edit PATCH (optimistic with per-row
 * revert + "Saved" pulse), push-to-Zendesk, and the slide-in details panel's
 * open/deleted/pushed callbacks. Returns a controller bag the thin shell renders.
 */
export function useUnfoundQueueTable() {
  const searchParams = useSearchParams();

  const kind = parseKind(searchParams.get('uf_kind'));
  const search = searchParams.get('uf_q') ?? '';

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);
  // Per-row "Saved" pulse — keyed `${kind}:${source_id}`, shows for ~1.5s
  // after a successful note / zendesk-id PATCH so the operator gets
  // unmistakable confirmation. Check toggles refetch instead, so the row
  // simply leaves the current tab.
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  // Slide-in details panel — open by clicking a row's subject/title. Lives
  // here (vs. its own URL route) so closing returns the operator to their
  // place in the table with scroll preserved.
  const [openRow, setOpenRow] = useState<QueueRow | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  const fetchRows = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    // 'checked' tab is a pseudo-kind: server-side it's kind=all + checked=true.
    // All other tabs hide checked rows so completed work disappears immediately.
    const serverKind = kind === 'checked' ? 'all' : kind;
    const serverChecked = kind === 'checked' ? 'true' : 'false';

    const url = new URL('/api/receiving/unfound-queue', window.location.origin);
    url.searchParams.set('kind', serverKind);
    url.searchParams.set('checked', serverChecked);
    if (search.trim()) url.searchParams.set('q', search.trim());

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = (await res.json()) as QueueResponse;
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `fetch failed (${res.status})`);
      }
      setRows(body.rows ?? []);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'fetch failed');
      setRows([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [kind, search]);

  // Debounce only when the search term changed. Kind toggles fetch immediately
  // so the operator's pill click feels instant.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(
      () => {
        void fetchRows();
      },
      search ? DEBOUNCE_MS : 0,
    );
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [fetchRows, search]);

  // Sidebar's Refresh button dispatches this so we don't need a shared ref.
  useEffect(() => {
    const handler = () => {
      void fetchRows();
    };
    window.addEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(UNFOUND_QUEUE_REFRESH_EVENT, handler);
  }, [fetchRows]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const patchRow = useCallback(
    async (row: QueueRow, patch: PatchBody) => {
      const rowKey = `${row.kind}:${row.source_id}`;
      const optimisticRow: QueueRow = { ...row, ...patch };
      const isCheckToggle = patch.checked !== undefined;

      // Optimistic update so the row reflects the change immediately. For a
      // check toggle the row will disappear on the next refetch anyway, but
      // the optimistic state keeps the checkbox in sync between click and
      // refetch.
      setRows((prev) =>
        prev.map((r) =>
          r.kind === row.kind && r.source_id === row.source_id
            ? optimisticRow
            : r,
        ),
      );

      try {
        const res = await fetch(
          `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) {
          console.error('[unfound-queue PATCH] failed', { status: res.status, body });
          throw new Error(
            body.error ??
              body.detail ??
              `patch failed (${res.status}${body.code ? ` · ${body.code}` : ''})`,
          );
        }

        if (isCheckToggle) {
          // Check toggles change the row's tab membership — pull a fresh
          // server view so the row leaves (or, on the Checked tab, joins)
          // the current list.
          void fetchRows();
        } else {
          // Note / Zendesk-ID updates keep the row in place. Show a brief
          // "Saved" pulse so the operator sees the write landed.
          setSavedKeys((prev) => {
            const next = new Set(prev);
            next.add(rowKey);
            return next;
          });
          setTimeout(() => {
            setSavedKeys((prev) => {
              if (!prev.has(rowKey)) return prev;
              const next = new Set(prev);
              next.delete(rowKey);
              return next;
            });
          }, 1500);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Update failed');
        setRows((prev) =>
          prev.map((r) =>
            r.kind === row.kind && r.source_id === row.source_id ? row : r,
          ),
        );
      }
    },
    [fetchRows],
  );

  const pushToZendesk = useCallback(
    async (row: QueueRow) => {
      const rowKey = `${row.kind}:${row.source_id}`;
      setPushing(rowKey);
      try {
        const res = await fetch(
          `/api/receiving/unfound-queue/${row.kind}/${encodeURIComponent(row.source_id)}/push-to-zendesk`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) {
          throw new Error(body.error ?? `push failed (${res.status})`);
        }
        toast.success(
          body.already_synced
            ? `Already on Zendesk ticket ${body.ticketNumber}`
            : `Zendesk ticket ${body.ticketNumber} created`,
        );
        await fetchRows();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Push to Zendesk failed');
      } finally {
        setPushing(null);
      }
    },
    [fetchRows],
  );

  const openSource = useCallback((row: QueueRow) => {
    // All kinds open into the slide-in details panel for inline review +
    // delete. Per-kind navigation (Open in Gmail / Open in workspace) lives
    // inside the panel as secondary actions.
    setOpenRow(row);
  }, []);

  const handleDeleted = useCallback((deletedRow: QueueRow) => {
    setRows((prev) =>
      prev.filter(
        (r) =>
          !(r.kind === deletedRow.kind && r.source_id === deletedRow.source_id),
      ),
    );
  }, []);

  const handlePushedToZendesk = useCallback(
    (pushedRow: QueueRow, ticketNumber: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.kind === pushedRow.kind && r.source_id === pushedRow.source_id
            ? { ...r, zendesk_ticket_id: ticketNumber }
            : r,
        ),
      );
    },
    [],
  );

  return {
    rows, loading, error, pushing, savedKeys,
    openRow, setOpenRow,
    patchRow, pushToZendesk, openSource, handleDeleted, handlePushedToZendesk,
  };
}
