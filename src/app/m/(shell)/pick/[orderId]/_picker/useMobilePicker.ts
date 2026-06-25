'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import type { ShortPickResult } from '@/components/mobile/picker/ShortPickSheet';
import { matchScanToTask, type PickOrder, type PickTask } from './picker-shared';

/**
 * Owns the mobile picker session: auth bounce, camera lifecycle, the bootstrap
 * (fetch pick-tasks + open a picking session, resume to the first open task),
 * optimistic confirm-pick (auto-completes the session on the last task) and
 * short-pick with rollback, the scan-gate decode handler, and the derived
 * current-task/progress flags. Returns a controller bag the thin page renders.
 */
export function useMobilePicker() {
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderIdParam = params?.orderId;
  const orderId = Number(orderIdParam);
  const { user, isLoaded } = useAuth();
  const scanner = useBarcodeScanner();

  const [order, setOrder] = useState<PickOrder | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pickedAllocations, setPickedAllocations] = useState<Set<number>>(() => new Set());
  const [shortSheetOpen, setShortSheetOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // ── Bounce to signin
  useEffect(() => {
    if (isLoaded && !user) {
      router.replace(`/signin?next=/m/pick${orderIdParam ? `/${orderIdParam}` : ''}`);
    }
  }, [isLoaded, user, router, orderIdParam]);

  // ── Camera lifecycle
  useEffect(() => {
    if (!user) return;
    void scanner.startScanning();
    return () => {
      void scanner.stopScanning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Bootstrap: fetch tasks + open session
  useEffect(() => {
    if (!user) return;
    if (!Number.isFinite(orderId) || orderId <= 0) {
      setLoadError('No order specified.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [tasksRes, sessionRes] = await Promise.all([
          fetch(`/api/orders/${orderId}/pick-tasks`, { cache: 'no-store' }),
          fetch('/api/picking/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId }),
          }),
        ]);
        if (!tasksRes.ok) throw new Error(`pick-tasks ${tasksRes.status}`);
        if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}`);
        const tasks = await tasksRes.json();
        const session = await sessionRes.json();
        if (cancelled) return;
        if (!tasks.ok) throw new Error(tasks.error || 'pick-tasks failed');
        if (!session.ok) throw new Error(session.error || 'session start failed');
        setOrder({
          orderId: tasks.orderId,
          orderLabel: tasks.orderLabel,
          customerInitials: tasks.customerInitials,
          shipByDate: tasks.shipByDate,
          tasks: tasks.tasks,
        });
        setSessionId(session.sessionId);
        // Skip already-PICKED rows when reopening a session.
        const firstOpen = tasks.tasks.findIndex(
          (t: PickTask) => t.currentState !== 'PICKED' && t.currentState !== 'PACKED' && t.currentState !== 'SHIPPED',
        );
        setCurrentIndex(firstOpen >= 0 ? firstOpen : tasks.tasks.length);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'load failed';
        setLoadError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, orderId]);

  const currentTask = order?.tasks[currentIndex];
  const totalTasks = order?.tasks.length ?? 0;
  const doneCount = pickedAllocations.size;
  const allDone = totalTasks > 0 && doneCount >= totalTasks;

  const advance = useCallback(() => {
    if (!order) return;
    const next = order.tasks.findIndex(
      (t, i) => i > currentIndex && !pickedAllocations.has(t.allocationId),
    );
    setCurrentIndex(next >= 0 ? next : order.tasks.length);
    setDetailsExpanded(false);
  }, [order, currentIndex, pickedAllocations]);

  // ── Confirm pick (POST /api/picking/session/:id/confirm-pick)
  const handleConfirmPick = useCallback(async () => {
    if (!currentTask || sessionId == null) return;
    setConfirming(true);
    // Optimistic — mark done, advance, reconcile on rejection.
    const allocationId = currentTask.allocationId;
    setPickedAllocations((prev) => {
      const next = new Set(prev);
      next.add(allocationId);
      return next;
    });
    try {
      const res = await fetch(`/api/picking/session/${sessionId}/confirm-pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocation_id: allocationId,
          client_event_id: `pick:${sessionId}:${allocationId}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `confirm-pick ${res.status}`);
      }
      // If this was the last open task, complete the session.
      const wasLast = currentIndex >= totalTasks - 1;
      if (wasLast) {
        await fetch(`/api/picking/session/${sessionId}/complete`, { method: 'POST' });
      } else {
        advance();
      }
    } catch (err) {
      // Roll back the optimistic mark.
      setPickedAllocations((prev) => {
        const next = new Set(prev);
        next.delete(allocationId);
        return next;
      });
      console.error('[m/pick] confirm-pick failed:', err);
    } finally {
      setConfirming(false);
    }
  }, [currentTask, sessionId, currentIndex, totalTasks, advance]);

  // ── Record short pick (POST /api/picking/session/:id/short-pick)
  const handleShortPick = useCallback(
    async (result: ShortPickResult) => {
      if (!currentTask || sessionId == null) return;
      const allocationId = currentTask.allocationId;
      // Optimistic mark.
      setPickedAllocations((prev) => {
        const next = new Set(prev);
        next.add(allocationId);
        return next;
      });
      try {
        const res = await fetch(`/api/picking/session/${sessionId}/short-pick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation_id: allocationId,
            picked_qty: result.pickedQty,
            planned_qty: result.plannedQty,
            reason: result.reason,
            note: result.note,
            client_event_id: `short:${sessionId}:${allocationId}`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `short-pick ${res.status}`);
        advance();
      } catch (err) {
        setPickedAllocations((prev) => {
          const next = new Set(prev);
          next.delete(allocationId);
          return next;
        });
        console.error('[m/pick] short-pick failed:', err);
      }
    },
    [currentTask, sessionId, advance],
  );

  // ── Scan-gate. Validate the scan identifies the right unit/bin/sku
  //    before confirming. Rejects mismatches with error feedback so
  //    accidental scans of nearby items don't false-confirm a pick.
  const handleScanDecode = useCallback(
    (value: string) => {
      if (!currentTask || confirming) return;
      const matched = matchScanToTask(value, currentTask);
      if (!matched) {
        const expectedBits = [
          currentTask.bin ? `bin ${currentTask.bin}` : null,
          currentTask.serialNumber ? `serial ${currentTask.serialNumber}` : null,
        ].filter(Boolean);
        setScanError(
          expectedBits.length > 0
            ? `Scanned "${value.trim()}" — expected ${expectedBits.join(' or ')}.`
            : `Scanned "${value.trim()}" — doesn't match this pick.`,
        );
        return;
      }
      setScanError(null);
      void handleConfirmPick();
    },
    [currentTask, confirming, handleConfirmPick],
  );

  // Clear stale error whenever the user moves to a new task.
  useEffect(() => {
    setScanError(null);
  }, [currentTask?.allocationId]);

  return {
    isLoaded, user,
    order, loadError,
    currentIndex,
    shortSheetOpen, setShortSheetOpen,
    confirming,
    detailsExpanded, setDetailsExpanded,
    scanError,
    scanner,
    currentTask, totalTasks, doneCount, allDone,
    handleConfirmPick, handleShortPick, handleScanDecode,
  };
}

export type MobilePickerController = ReturnType<typeof useMobilePicker>;
