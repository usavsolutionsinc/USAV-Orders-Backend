'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchManuals } from '../manuals-library-api';
import type { ManualRow } from '../manuals-tree';

export interface UseManualsData {
  manuals: ManualRow[];
  setManuals: React.Dispatch<React.SetStateAction<ManualRow[]>>;
  loading: boolean;
  /** Bumped on every refetch — consumers reset selection etc. when it changes. */
  reloadToken: number;
  reload: () => void;
}

/**
 * Owns the manual list and its refetch lifecycle. Refetches when `reload()` is
 * called and whenever any modal in ManualCrudModals dispatches `manuals-updated`
 * (so the tree stays in sync without prop-drilling). `setManuals` is exposed for
 * the optimistic thumbnail-backfill patch.
 */
export function useManualsData(): UseManualsData {
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchManuals()
      .then((rows) => {
        if (!cancelled) setManuals(rows);
      })
      .catch(() => {
        if (!cancelled) setManuals([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    const onUpdated = () => reload();
    window.addEventListener('manuals-updated', onUpdated);
    return () => window.removeEventListener('manuals-updated', onUpdated);
  }, [reload]);

  return { manuals, setManuals, loading, reloadToken, reload };
}
