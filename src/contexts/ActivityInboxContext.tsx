'use client';

/**
 * Activity inbox — session-scoped “recent reversible actions”.
 * Complements Operations Log (audit trail); inbox is ephemeral UI +
 * quick undo within a short TTL.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';

const MAX_ITEMS = 20;
/** Time window during which Undo is offered for reversible items */
export const ACTIVITY_INBOX_UNDO_MS = 60_000;

export type ActivityInboxItemKind = 'repair_status';

export interface ActivityInboxItem {
  id: string;
  kind: ActivityInboxItemKind;
  title: string;
  subtitle: string;
  createdAt: number;
  undoUntil: number;
  repairId?: number;
  previousStatus?: string;
  nextStatus?: string;
  undone?: boolean;
  undoFailed?: boolean;
}

type PushRepairStatusArgs = {
  repairId: number;
  displayCode?: string;
  previousStatus: string | null | undefined;
  nextStatus: string;
};

interface ActivityInboxContextValue {
  items: ActivityInboxItem[];
  /** Id of inbox row currently executing undo (if any). */
  pendingUndoId: string | null;
  pushRepairStatusChange: (args: PushRepairStatusArgs) => void;
  undoItem: (id: string) => Promise<void>;
  dismissItem: (id: string) => void;
  clear: () => void;
}

const ActivityInboxContext = createContext<ActivityInboxContextValue | null>(
  null,
);

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ActivityInboxProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<ActivityInboxItem[]>([]);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) setItems([]);
  }, [user]);

  const pushRepairStatusChange = useCallback(
    ({
      repairId,
      displayCode,
      previousStatus,
      nextStatus,
    }: PushRepairStatusArgs) => {
      if (!user) return;
      const prev =
        typeof previousStatus === 'string' ? previousStatus : '';
      if (prev === nextStatus) return;

      const now = Date.now();
      const label = displayCode ?? `RS-${repairId}`;
      const item: ActivityInboxItem = {
        id: newId(),
        kind: 'repair_status',
        title: `Repair · ${label}`,
        subtitle: `Status · ${truncateLabel(prev || '(none)')} → ${truncateLabel(nextStatus)}`,
        createdAt: now,
        undoUntil: now + ACTIVITY_INBOX_UNDO_MS,
        repairId,
        previousStatus: prev,
        nextStatus,
      };

      setItems((prevItems) => [item, ...prevItems].slice(0, MAX_ITEMS));
    },
    [user],
  );

  const undoItem = useCallback(
    async (id: string) => {
      const item = items.find((x) => x.id === id);
      if (
        !item ||
        item.kind !== 'repair_status' ||
        item.undone ||
        !item.repairId ||
        item.previousStatus === undefined
      ) {
        return;
      }
      if (Date.now() > item.undoUntil) {
        toast.error('Undo window expired');
        return;
      }

      setPendingUndoId(id);
      try {
        const res = await fetch('/api/repair-service', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.repairId,
            status: item.previousStatus,
          }),
        });
        if (!res.ok) {
          throw new Error('Request failed');
        }
        toast.success('Change reverted');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['repairs'] }),
          queryClient.invalidateQueries({
            queryKey: ['repair', item.repairId],
          }),
        ]);
        setItems((prevItems) =>
          prevItems.map((x) =>
            x.id === id ? { ...x, undone: true } : x,
          ),
        );
      } catch {
        toast.error('Could not undo');
        setItems((prevItems) =>
          prevItems.map((x) =>
            x.id === id ? { ...x, undoFailed: true } : x,
          ),
        );
      } finally {
        setPendingUndoId(null);
      }
    },
    [items, queryClient],
  );

  const dismissItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<ActivityInboxContextValue>(
    () => ({
      items,
      pendingUndoId,
      pushRepairStatusChange,
      undoItem,
      dismissItem,
      clear,
    }),
    [
      items,
      pendingUndoId,
      pushRepairStatusChange,
      undoItem,
      dismissItem,
      clear,
    ],
  );

  return (
    <ActivityInboxContext.Provider value={value}>
      {children}
      {/* Reactive tick so undo badges expire without user interaction */}
      <InboxTTLWatcher items={items} />
    </ActivityInboxContext.Provider>
  );
}

function truncateLabel(s: string, max = 52): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function InboxTTLWatcher({ items }: { items: ActivityInboxItem[] }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasActiveUndo = items.some(
      (i) =>
        !i.undone &&
        !i.undoFailed &&
        Date.now() < i.undoUntil,
    );
    if (!hasActiveUndo) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [items]);
  return null;
}

export function useActivityInbox(): ActivityInboxContextValue {
  const ctx = useContext(ActivityInboxContext);
  if (!ctx) {
    throw new Error('useActivityInbox must be used within ActivityInboxProvider');
  }
  return ctx;
}

/** Safe for optional UI — returns no-ops when provider missing (tests / storybook). */
export function useActivityInboxOptional(): ActivityInboxContextValue | null {
  return useContext(ActivityInboxContext);
}
