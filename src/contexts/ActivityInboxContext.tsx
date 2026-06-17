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
import { qk } from '@/queries/keys';
import { useAuth } from '@/contexts/AuthContext';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getInboxChannelName, safeChannelName } from '@/lib/realtime/channels';
import { toast } from '@/lib/toast';

const MAX_ITEMS = 20;
/** Time window during which Undo is offered for reversible items */
export const ACTIVITY_INBOX_UNDO_MS = 60_000;

export type ActivityInboxItemKind =
  | 'repair_status'
  | 'priority_unbox'
  | 'warranty_claim'
  | 'return_pending_test'
  | 'order_ready_ship'
  | 'staff_message';

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
  // priority_unbox
  sku?: string;
  trackingNumber?: string;
  receivingId?: number;
  // warranty_claim
  claimId?: number;
  claimNumber?: string;
  claimStatus?: string;
  // staff_message
  messageId?: number;
  senderName?: string;
  /** Raw copied text — used for the "copy back" affordance in the popover. */
  body?: string;
}

const WARRANTY_EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  denied: 'Denied',
  in_repair: 'In repair',
  repair_logged: 'Repair logged',
  repaired: 'Repaired',
  closed: 'Closed',
  expired: 'Expired',
};

type PushRepairStatusArgs = {
  repairId: number;
  displayCode?: string;
  previousStatus: string | null | undefined;
  nextStatus: string;
};

type PushPriorityUnboxArgs = {
  skus: string[];
  trackingNumber?: string | null;
  receivingId?: number | null;
};

type PushWarrantyClaimArgs = {
  claimId: number;
  claimNumber: string;
  status: string;
  event: string;
  title?: string | null;
};

interface ActivityInboxContextValue {
  items: ActivityInboxItem[];
  /** Id of inbox row currently executing undo (if any). */
  pendingUndoId: string | null;
  pushRepairStatusChange: (args: PushRepairStatusArgs) => void;
  pushPriorityUnbox: (args: PushPriorityUnboxArgs) => void;
  pushWarrantyClaim: (args: PushWarrantyClaimArgs) => void;
  undoItem: (id: string) => Promise<void>;
  dismissItem: (id: string) => void;
  /** Mark a received staff message read (clears it from the bell). */
  markStaffMessageRead: (messageId: number) => Promise<void>;
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
  // Derive-live tech-station backlog (unboxed returns awaiting test + orders
  // ready to ship). Kept separate from the ephemeral push items so a refetch
  // replaces it wholesale without wiping repair/warranty/priority-unbox toasts.
  const [techQueueItems, setTechQueueItems] = useState<ActivityInboxItem[]>([]);
  // Persisted staff-to-staff messages (clipboard "send to staff"). Like the
  // tech backlog, seeded from the DB on mount and refetched on each push so it
  // survives reload — these are the first inbox items with a durable source.
  const [staffMessageItems, setStaffMessageItems] = useState<ActivityInboxItem[]>([]);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setTechQueueItems([]);
      setStaffMessageItems([]);
    }
  }, [user]);

  // Tech-station inbox: seed the backlog from the DB on mount and refetch on
  // each push (the publishers fan out to primary techs only; non-techs get an
  // empty queue server-side). Survives reload, shows the true backlog.
  const refreshTechQueue = useCallback(async () => {
    if (!user?.staffId) {
      setTechQueueItems([]);
      return;
    }
    try {
      const res = await fetch('/api/inbox/tech-queue');
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: Array<{
          kind: ActivityInboxItemKind;
          receivingId: number;
          trackingNumber: string | null;
          unboxedAt: string | null;
        }>;
      };
      const mapped: ActivityInboxItem[] = (data.items ?? []).map((it) => {
        const ms = it.unboxedAt ? new Date(it.unboxedAt).getTime() : Date.now();
        const isReturn = it.kind === 'return_pending_test';
        return {
          id: `techq-${it.kind}-${it.receivingId}`,
          kind: it.kind,
          title: isReturn ? 'Return · needs testing' : 'Order · ready to ship',
          subtitle: it.trackingNumber
            ? `${isReturn ? 'Unboxed return' : 'Unboxed · pending order'} · ${truncateLabel(it.trackingNumber, 40)}`
            : isReturn
              ? 'Unboxed return awaiting test'
              : 'Unboxed — pending order ready to ship',
          createdAt: Number.isFinite(ms) ? ms : Date.now(),
          undoUntil: 0, // backlog items are not reversible
          receivingId: it.receivingId,
          trackingNumber: it.trackingNumber ?? undefined,
        };
      });
      setTechQueueItems(mapped);
    } catch {
      /* best-effort — next push or reload retries */
    }
  }, [user?.staffId]);

  useEffect(() => {
    void refreshTechQueue();
  }, [refreshTechQueue]);

  // Persisted unread staff messages. Seeded on mount and refetched whenever a
  // staff_message push lands (authoritative read model, like the tech queue).
  const refreshStaffMessages = useCallback(async () => {
    if (!user?.staffId) {
      setStaffMessageItems([]);
      return;
    }
    try {
      const res = await fetch('/api/staff-messages?unread=1', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: Array<{
          id: number;
          senderName: string;
          body: string;
          kind: string;
          context: Record<string, unknown> | null;
          createdAtMs: number;
        }>;
      };
      const mapped: ActivityInboxItem[] = (data.items ?? []).map((m) => {
        const ctx = m.context ?? {};
        const sellerMessageId =
          typeof ctx.sellerMessageId === 'number' ? ctx.sellerMessageId : null;
        if (m.kind === 'seller_claim_message' && sellerMessageId) {
          return {
            id: `msg-${m.id}`,
            kind: 'staff_message' as const,
            title: `Seller msg #${sellerMessageId}`,
            subtitle: `From ${truncateLabel(m.senderName, 32)} · copy for full text`,
            createdAt: Number.isFinite(m.createdAtMs) ? m.createdAtMs : Date.now(),
            undoUntil: 0, // not reversible
            messageId: m.id,
            senderName: m.senderName,
            body: m.body,
          };
        }
        return {
          id: `msg-${m.id}`,
          kind: 'staff_message' as const,
          title: `Message · ${truncateLabel(m.senderName, 32)}`,
          subtitle: m.body,
          createdAt: Number.isFinite(m.createdAtMs) ? m.createdAtMs : Date.now(),
          undoUntil: 0, // not reversible
          messageId: m.id,
          senderName: m.senderName,
          body: m.body,
        };
      });
      setStaffMessageItems(mapped);
    } catch {
      /* best-effort — next push or reload retries */
    }
  }, [user?.staffId]);

  useEffect(() => {
    void refreshStaffMessages();
  }, [refreshStaffMessages]);

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

  const pushPriorityUnbox = useCallback(
    ({ skus, trackingNumber, receivingId }: PushPriorityUnboxArgs) => {
      if (!user) return;
      const cleanSkus = (skus ?? []).filter(
        (s) => typeof s === 'string' && s.trim().length > 0,
      );
      if (cleanSkus.length === 0) return;

      const now = Date.now();
      const skuLabel =
        cleanSkus.length === 1
          ? cleanSkus[0]
          : `${cleanSkus[0]} +${cleanSkus.length - 1}`;
      const item: ActivityInboxItem = {
        id: newId(),
        kind: 'priority_unbox',
        title: `Unbox first · ${truncateLabel(skuLabel, 40)}`,
        subtitle: trackingNumber
          ? `On a pending order · ${truncateLabel(trackingNumber, 40)}`
          : 'On a pending order — unbox this one first',
        createdAt: now,
        undoUntil: now, // alerts aren't reversible
        sku: cleanSkus[0],
        trackingNumber: trackingNumber ?? undefined,
        receivingId: receivingId ?? undefined,
      };

      setItems((prevItems) => [item, ...prevItems].slice(0, MAX_ITEMS));
    },
    [user],
  );

  const pushWarrantyClaim = useCallback(
    ({ claimId, claimNumber, status, event, title }: PushWarrantyClaimArgs) => {
      if (!user) return;
      if (!claimId || !claimNumber) return;
      const now = Date.now();
      const eventLabel = WARRANTY_EVENT_LABEL[event] ?? truncateLabel(event, 24);
      const item: ActivityInboxItem = {
        id: newId(),
        kind: 'warranty_claim',
        title: `Warranty · ${truncateLabel(claimNumber, 40)}`,
        subtitle: title
          ? `${eventLabel} · ${truncateLabel(title, 40)}`
          : eventLabel,
        createdAt: now,
        undoUntil: now, // not reversible from the inbox
        claimId,
        claimNumber,
        claimStatus: status,
      };
      setItems((prevItems) => [item, ...prevItems].slice(0, MAX_ITEMS));
    },
    [user],
  );

  // Receiving-door scans that hit a pending order are pushed to inbox:{staffId}
  // server-side; mirror them into the inbox wherever this staff is signed in.
  const inboxChannel = safeChannelName(() =>
    getInboxChannelName(user?.organizationId!, user?.staffId ?? 'none'),
  );
  const inboxEnabled = !!inboxChannel && Boolean(user?.staffId);
  useAblyChannel(
    inboxChannel,
    'priority_unbox',
    (msg: { data?: { skus?: unknown; trackingNumber?: unknown; receivingId?: unknown } }) => {
      const d = msg?.data ?? {};
      pushPriorityUnbox({
        skus: Array.isArray(d.skus) ? (d.skus as string[]) : [],
        trackingNumber: typeof d.trackingNumber === 'string' ? d.trackingNumber : null,
        receivingId: typeof d.receivingId === 'number' ? d.receivingId : null,
      });
    },
    inboxEnabled,
  );

  // Warranty claim status changes for claims this staff logged.
  useAblyChannel(
    inboxChannel,
    'warranty_claim',
    (msg: { data?: { claimId?: unknown; claimNumber?: unknown; status?: unknown; event?: unknown; title?: unknown } }) => {
      const d = msg?.data ?? {};
      const claimId = typeof d.claimId === 'number' ? d.claimId : Number(d.claimId);
      if (!Number.isFinite(claimId) || claimId <= 0) return;
      pushWarrantyClaim({
        claimId,
        claimNumber: typeof d.claimNumber === 'string' ? d.claimNumber : String(d.claimNumber ?? ''),
        status: typeof d.status === 'string' ? d.status : '',
        event: typeof d.event === 'string' ? d.event : '',
        title: typeof d.title === 'string' ? d.title : null,
      });
    },
    inboxEnabled,
  );

  // Tech-station backlog nudges — fan-out reaches primary techs only. Either
  // event just means "your queue changed", so refetch the authoritative list.
  useAblyChannel(inboxChannel, 'return_pending_test', () => void refreshTechQueue(), inboxEnabled);
  useAblyChannel(inboxChannel, 'order_ready_ship', () => void refreshTechQueue(), inboxEnabled);

  // Direct staff-to-staff messages (clipboard "send to staff"). Toast the
  // arrival, then refetch the authoritative unread list for the bell.
  useAblyChannel(
    inboxChannel,
    'staff_message',
    (msg: { data?: { senderName?: unknown } }) => {
      const sender = typeof msg?.data?.senderName === 'string' ? msg.data.senderName : 'A teammate';
      toast.success(`New message from ${sender}`);
      void refreshStaffMessages();
    },
    inboxEnabled,
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
          queryClient.invalidateQueries({ queryKey: qk.repairs.all }),
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

  // Mark a received staff message read on the server and drop it locally.
  const markStaffMessageRead = useCallback(async (messageId: number) => {
    setStaffMessageItems((prev) => prev.filter((x) => x.messageId !== messageId));
    try {
      await fetch('/api/staff-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read', id: messageId }),
      });
    } catch {
      /* best-effort — reload re-fetches the true unread set */
    }
  }, []);

  const dismissItem = useCallback(
    (id: string) => {
      const msg = staffMessageItems.find((x) => x.id === id);
      if (msg?.messageId != null) {
        void markStaffMessageRead(msg.messageId);
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
      setTechQueueItems((prev) => prev.filter((x) => x.id !== id));
    },
    [staffMessageItems, markStaffMessageRead],
  );

  const clear = useCallback(() => {
    setItems([]);
    setTechQueueItems([]);
    if (staffMessageItems.length > 0) {
      setStaffMessageItems([]);
      // Persisted messages must be marked read or they'd reappear on reload.
      void fetch('/api/staff-messages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_all_read' }),
      }).catch(() => {});
    }
  }, [staffMessageItems]);

  // Ephemeral push items + the derive-live tech backlog + persisted unread
  // staff messages, newest first.
  const mergedItems = useMemo(
    () =>
      [...items, ...techQueueItems, ...staffMessageItems]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_ITEMS),
    [items, techQueueItems, staffMessageItems],
  );

  const value = useMemo<ActivityInboxContextValue>(
    () => ({
      items: mergedItems,
      pendingUndoId,
      pushRepairStatusChange,
      pushPriorityUnbox,
      pushWarrantyClaim,
      undoItem,
      dismissItem,
      markStaffMessageRead,
      clear,
    }),
    [
      mergedItems,
      pendingUndoId,
      pushRepairStatusChange,
      pushPriorityUnbox,
      pushWarrantyClaim,
      undoItem,
      dismissItem,
      markStaffMessageRead,
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
