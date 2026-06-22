'use client';

/**
 * FBA board data: fetches `/api/fba/board`, holds the working `pending` list,
 * and keeps it fresh via the FBA event bus — full refetch on refresh/print, plus
 * optimistic single-item inject (select-mode auto-add) and bulk remove
 * (after combine/ship) without a round-trip. Also refetches on the `?r=` URL
 * trigger. Extracted from fba/page; behaviour is unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  USAV_REFRESH_DATA,
  FBA_PRINT_SHIPPED,
  FBA_BOARD_INJECT_ITEM,
  FBA_BOARD_REMOVE_ITEMS,
} from '@/lib/fba/events';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import type { CombineData } from './fba-page-helpers';

export interface FbaBoardData {
  board: CombineData;
  loading: boolean;
  error: string | null;
  fetchBoard: () => Promise<void>;
}

export function useFbaBoard(): FbaBoardData {
  const searchParams = useSearchParams();
  const refreshTrigger = Number(searchParams.get('r') || 0);

  const [board, setBoard] = useState<CombineData>({ pending: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/fba/board');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch board');
      setBoard({
        pending: data.pending ?? [...(data.packed ?? []), ...(data.awaiting ?? [])],
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard, refreshTrigger]);

  useEffect(() => {
    const handler = () => fetchBoard();
    window.addEventListener(USAV_REFRESH_DATA, handler);
    window.addEventListener(FBA_PRINT_SHIPPED, handler);

    // Select-mode auto-add: inject a single item without a full board refresh.
    const injectHandler = (e: Event) => {
      const item = (e as CustomEvent<FbaBoardItem>).detail;
      if (!item?.item_id) return;
      setBoard((prev) => {
        if (prev.pending.some((i) => i.item_id === item.item_id)) return prev;
        return { pending: [...prev.pending, item] };
      });
    };
    window.addEventListener(FBA_BOARD_INJECT_ITEM, injectHandler);

    // After combine/ship: remove items from board immediately.
    const removeHandler = (e: Event) => {
      const ids = (e as CustomEvent<number[]>).detail;
      if (!Array.isArray(ids) || ids.length === 0) return;
      const removeSet = new Set(ids);
      setBoard((prev) => ({
        pending: prev.pending.filter((i) => !removeSet.has(i.item_id)),
      }));
    };
    window.addEventListener(FBA_BOARD_REMOVE_ITEMS, removeHandler);

    return () => {
      window.removeEventListener(USAV_REFRESH_DATA, handler);
      window.removeEventListener(FBA_PRINT_SHIPPED, handler);
      window.removeEventListener(FBA_BOARD_INJECT_ITEM, injectHandler);
      window.removeEventListener(FBA_BOARD_REMOVE_ITEMS, removeHandler);
    };
  }, [fetchBoard]);

  return { board, loading, error, fetchBoard };
}
