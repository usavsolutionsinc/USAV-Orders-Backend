'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  HubCandidate,
  HubConfirmed,
  HubSnapshot,
  PendingAction,
  PendingUnpair,
} from './types';

interface UseProductHubResult {
  snapshot: HubSnapshot | null;
  loading: boolean;
  error: string | null;
  /** All pending actions, keyed by platformIdRowId for fast lookup. */
  pendingByRowId: Map<number, PendingAction | PendingUnpair>;
  acceptCount: number;
  rejectCount: number;
  unpairCount: number;
  /** Total number of ranked suggestions across every platform in the snapshot. */
  suggestionTotal: number;
  saving: boolean;
  saveError: string | null;
  lastSavedAuditIds: number[] | null;
  toggleAccept: (candidate: HubCandidate) => void;
  toggleReject: (candidate: HubCandidate) => void;
  toggleUnpair: (confirmed: HubConfirmed) => void;
  clearPending: () => void;
  commit: () => Promise<void>;
  /**
   * One-click commit: pair every selected (accepted) suggestion AND reject every
   * suggestion the operator left unselected, plus any pending unpairs. Lets the
   * operator clear the whole queue with a single action.
   */
  commitDecisive: () => Promise<void>;
  refresh: () => void;
}

const EMPTY_PENDING = new Map<number, PendingAction | PendingUnpair>();

export function useProductHub(skuCatalogId: number | null): UseProductHubResult {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Map<number, PendingAction | PendingUnpair>>(EMPTY_PENDING);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAuditIds, setLastSavedAuditIds] = useState<number[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);

  // ── Pre-select high-confidence candidates on load ─────────────────────────
  const seedPending = useCallback((snap: HubSnapshot) => {
    const next = new Map<number, PendingAction | PendingUnpair>();
    for (const platform of Object.keys(snap.suggestions)) {
      for (const c of snap.suggestions[platform]) {
        if (c.confidence >= 80) {
          next.set(c.platformIdRowId, { kind: 'accept', candidate: c });
        }
      }
    }
    setPending(next);
  }, []);

  useEffect(() => {
    if (skuCatalogId == null) {
      setSnapshot(null);
      setPending(EMPTY_PENDING);
      return;
    }
    const id = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveError(null);
    setLastSavedAuditIds(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/sku-catalog/suggest-pairings?skuCatalogId=${skuCatalogId}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data: HubSnapshot = await res.json();
        if (cancelled || id !== requestIdRef.current) return;
        setSnapshot(data);
        seedPending(data);
      } catch (err) {
        if (cancelled || id !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'failed');
        setSnapshot(null);
        setPending(EMPTY_PENDING);
      } finally {
        if (!cancelled && id === requestIdRef.current) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [skuCatalogId, refreshKey, seedPending]);

  // ── Toggles (immutably swap entries in the pending map) ───────────────────
  const toggleAccept = useCallback((candidate: HubCandidate) => {
    setPending((prev) => {
      const next = new Map(prev);
      const cur = next.get(candidate.platformIdRowId);
      if (cur && cur.kind === 'accept') next.delete(candidate.platformIdRowId);
      else next.set(candidate.platformIdRowId, { kind: 'accept', candidate });
      return next;
    });
  }, []);

  const toggleReject = useCallback((candidate: HubCandidate) => {
    setPending((prev) => {
      const next = new Map(prev);
      const cur = next.get(candidate.platformIdRowId);
      if (cur && cur.kind === 'reject') next.delete(candidate.platformIdRowId);
      else next.set(candidate.platformIdRowId, { kind: 'reject', candidate });
      return next;
    });
  }, []);

  const toggleUnpair = useCallback((confirmed: HubConfirmed) => {
    setPending((prev) => {
      const next = new Map(prev);
      const cur = next.get(confirmed.platformIdRowId);
      if (cur && cur.kind === 'unpair') next.delete(confirmed.platformIdRowId);
      else next.set(confirmed.platformIdRowId, { kind: 'unpair', confirmed });
      return next;
    });
  }, []);

  const clearPending = useCallback(() => setPending(EMPTY_PENDING), []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Counts ────────────────────────────────────────────────────────────────
  const { acceptCount, rejectCount, unpairCount } = useMemo(() => {
    let a = 0, r = 0, u = 0;
    for (const action of pending.values()) {
      if (action.kind === 'accept') a += 1;
      else if (action.kind === 'reject') r += 1;
      else u += 1;
    }
    return { acceptCount: a, rejectCount: r, unpairCount: u };
  }, [pending]);

  const suggestionTotal = useMemo(() => {
    if (!snapshot) return 0;
    let n = 0;
    for (const platform of Object.keys(snapshot.suggestions)) {
      n += snapshot.suggestions[platform].length;
    }
    return n;
  }, [snapshot]);

  // ── Commit ────────────────────────────────────────────────────────────────
  /** Shared POST → /pair-batch. Resets pending + refreshes on success. */
  const postBatch = useCallback(
    async (
      accept: Array<{ platformIdRowId: number; confidence: number; reason: string }>,
      reject: Array<{ platformIdRowId: number; reason: string }>,
      unpair: Array<{ platformIdRowId: number; reason: string }>,
    ) => {
      if (!snapshot) return;
      if (accept.length === 0 && reject.length === 0 && unpair.length === 0) return;
      setSaving(true);
      setSaveError(null);
      setLastSavedAuditIds(null);
      try {
        const res = await fetch('/api/sku-catalog/pair-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            skuCatalogId: snapshot.skuCatalogId,
            accept,
            reject,
            unpair,
          }),
        });
        const body = await res.json();
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        setLastSavedAuditIds(body.auditIds || []);
        setPending(EMPTY_PENDING);
        window.dispatchEvent(new CustomEvent('sku-pairing-updated'));
        refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'save failed');
      } finally {
        setSaving(false);
      }
    },
    [snapshot, refresh],
  );

  const commit = useCallback(async () => {
    if (!snapshot || pending.size === 0) return;

    const accept: Array<{ platformIdRowId: number; confidence: number; reason: string }> = [];
    const reject: Array<{ platformIdRowId: number; reason: string }> = [];
    const unpair: Array<{ platformIdRowId: number; reason: string }> = [];

    for (const action of pending.values()) {
      if (action.kind === 'accept') {
        accept.push({
          platformIdRowId: action.candidate.platformIdRowId,
          confidence: action.candidate.confidence,
          reason: action.candidate.reason,
        });
      } else if (action.kind === 'reject') {
        reject.push({
          platformIdRowId: action.candidate.platformIdRowId,
          reason: 'operator_rejected',
        });
      } else if (action.kind === 'unpair') {
        unpair.push({
          platformIdRowId: action.confirmed.platformIdRowId,
          reason: 'operator_unpair',
        });
      }
    }

    await postBatch(accept, reject, unpair);
  }, [snapshot, pending, postBatch]);

  const commitDecisive = useCallback(async () => {
    if (!snapshot) return;

    // Selected = currently-accepted suggestions; everything else gets rejected.
    const acceptedIds = new Set<number>();
    for (const action of pending.values()) {
      if (action.kind === 'accept') acceptedIds.add(action.candidate.platformIdRowId);
    }

    const accept: Array<{ platformIdRowId: number; confidence: number; reason: string }> = [];
    const reject: Array<{ platformIdRowId: number; reason: string }> = [];
    for (const platform of Object.keys(snapshot.suggestions)) {
      for (const c of snapshot.suggestions[platform]) {
        if (acceptedIds.has(c.platformIdRowId)) {
          accept.push({
            platformIdRowId: c.platformIdRowId,
            confidence: c.confidence,
            reason: c.reason,
          });
        } else {
          reject.push({ platformIdRowId: c.platformIdRowId, reason: 'operator_rejected' });
        }
      }
    }

    // Preserve any pending unpairs of already-confirmed rows.
    const unpair: Array<{ platformIdRowId: number; reason: string }> = [];
    for (const action of pending.values()) {
      if (action.kind === 'unpair') {
        unpair.push({ platformIdRowId: action.confirmed.platformIdRowId, reason: 'operator_unpair' });
      }
    }

    await postBatch(accept, reject, unpair);
  }, [snapshot, pending, postBatch]);

  return {
    snapshot,
    loading,
    error,
    pendingByRowId: pending,
    acceptCount,
    rejectCount,
    unpairCount,
    suggestionTotal,
    saving,
    saveError,
    lastSavedAuditIds,
    toggleAccept,
    toggleReject,
    toggleUnpair,
    clearPending,
    commit,
    commitDecisive,
    refresh,
  };
}
