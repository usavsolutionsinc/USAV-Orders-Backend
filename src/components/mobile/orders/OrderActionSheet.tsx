'use client';

/**
 * OrderActionSheet
 * ───────────────────────────────────────────────────────────────────────
 * The single launcher for every mutation the mobile order detail page
 * exposes. Opens from the sticky "Actions" button on `/m/orders/[orderId]`
 * and shows only the action rows that are valid for the order's current
 * status.
 *
 * Each row that performs a write opens a STACKED confirmation sheet
 * (`level={1}`) so the worker has to dismiss the confirmation deliberately
 * — preventing accidental writes on a phone in a warehouse pocket.
 *
 * IMPORTANT: No action in this sheet posts to the receiving database
 * table from the mobile center scan path. The receive/quarantine rows
 * call the dedicated receiving station endpoints — and only when the
 * worker has explicitly chosen them from an open order.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { BottomSheet, ConfirmSheet, PromptSheet } from '@/components/ui/BottomSheet';

export interface OrderActionContext {
  orderId: string;
  status: string | null;
  hasShipment: boolean;
  hasSerial: boolean;
}

interface OrderActionSheetProps {
  open: boolean;
  onClose: () => void;
  order: OrderActionContext;
  onMutated?: () => void;
}

type ActionGroup = 'receive' | 'tech' | 'pack' | 'inventory' | 'comms' | 'nav';

interface ActionRow {
  id: string;
  label: string;
  description?: string;
  group: ActionGroup;
  /** Hide entirely if the predicate returns false. */
  visible: (ctx: OrderActionContext) => boolean;
  /** Destructive actions get a red confirm button. */
  destructive?: boolean;
  /** Build the confirm sheet payload + perform the write. */
  run: (ctx: OrderActionContext) => Promise<void> | void;
}

// ─── Action catalog ──────────────────────────────────────────────────────────
//
// Only the rows whose `visible` returns true for the current order render.
// Hidden (not disabled) — on a phone, fewer dead taps is the rule.

function buildActions(onCommitNote: (orderId: string, note: string) => Promise<void>,
                     onAssignBin: (orderId: string, bin: string) => Promise<void>,
                     onMarkTested: (orderId: string, pass: boolean) => Promise<void>,
                     onMarkPacked: (orderId: string) => Promise<void>,
                     onPrintLabel: (orderId: string) => Promise<void>,
                     onQuarantine: (orderId: string, reason: string) => Promise<void>,
                     router: (path: string) => void): ActionRow[] {
  return [
    // ── Receive / intake ────────────────────────────────────────────────
    {
      id: 'assign-bin', label: 'Assign to bin', group: 'receive',
      visible: () => true,
      run: async (ctx) => {
        const bin = window.prompt('Bin barcode or name');
        if (bin) await onAssignBin(ctx.orderId, bin.trim());
      },
    },
    {
      id: 'quarantine', label: 'Quarantine / mismatch', group: 'receive',
      destructive: true,
      visible: () => true,
      run: async (ctx) => {
        const reason = window.prompt('Reason (damage, wrong item, missing parts…)');
        if (reason) await onQuarantine(ctx.orderId, reason.trim());
      },
    },

    // ── Tech / repair ───────────────────────────────────────────────────
    {
      id: 'tested-pass', label: 'Mark tested — PASS', group: 'tech',
      visible: (ctx) => ctx.status !== 'shipped' && ctx.status !== 'cancelled',
      run: (ctx) => onMarkTested(ctx.orderId, true),
    },
    {
      id: 'tested-fail', label: 'Mark tested — FAIL', group: 'tech',
      destructive: true,
      visible: (ctx) => ctx.status !== 'shipped' && ctx.status !== 'cancelled',
      run: (ctx) => onMarkTested(ctx.orderId, false),
    },

    // ── Pack / ship ─────────────────────────────────────────────────────
    {
      id: 'print-label', label: 'Print shipping label', group: 'pack',
      visible: (ctx) => ctx.status !== 'shipped',
      run: (ctx) => onPrintLabel(ctx.orderId),
    },
    {
      id: 'mark-packed', label: 'Mark packed', group: 'pack',
      visible: (ctx) => ctx.status !== 'shipped' && ctx.status !== 'cancelled',
      run: (ctx) => onMarkPacked(ctx.orderId),
    },

    // ── Inventory ───────────────────────────────────────────────────────
    {
      id: 'move-fba', label: 'Move to FBA', group: 'inventory',
      visible: (ctx) => ctx.status !== 'shipped',
      run: (ctx) => router(`/inventory/fba?order=${encodeURIComponent(ctx.orderId)}`),
    },

    // ── Comms / admin ───────────────────────────────────────────────────
    {
      id: 'add-note', label: 'Add note', group: 'comms',
      visible: () => true,
      run: async (ctx) => {
        const note = window.prompt('Note');
        if (note) await onCommitNote(ctx.orderId, note.trim());
      },
    },

    // ── Navigation shortcuts ────────────────────────────────────────────
    {
      id: 'open-desktop', label: 'Open in desktop view', group: 'nav',
      visible: () => true,
      run: (ctx) => router(`/orders/${encodeURIComponent(ctx.orderId)}`),
    },
    {
      id: 'open-history', label: 'View full history', group: 'nav',
      visible: () => true,
      run: (ctx) => router(`/orders/${encodeURIComponent(ctx.orderId)}/history`),
    },
  ];
}

const GROUP_LABELS: Record<ActionGroup, string> = {
  receive: 'Receive / intake',
  tech: 'Tech / repair',
  pack: 'Pack / ship',
  inventory: 'Inventory',
  comms: 'Comms / admin',
  nav: 'Open elsewhere',
};

const GROUP_ORDER: ActionGroup[] = ['receive', 'tech', 'pack', 'inventory', 'comms', 'nav'];

// ─── Endpoint shims ──────────────────────────────────────────────────────────
//
// Thin wrappers that POST to the right API. Kept in this file (rather than
// scattered across the action rows) so it is obvious at a glance that NONE
// of them target /api/receiving* — that endpoint is reserved for the
// dedicated receiving station UI.

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OrderActionSheet({ open, onClose, order, onMutated }: OrderActionSheetProps) {
  const [confirm, setConfirm] = useState<ActionRow | null>(null);
  const [promptOpen, setPromptOpen] = useState<null | { title: string; placeholder?: string; commit: (v: string) => Promise<void> }>(null);

  const fireAndRefresh = async (work: () => Promise<unknown>, successMsg: string) => {
    try {
      await work();
      toast.success(successMsg);
      onMutated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast.error(msg);
    }
  };

  const commitNote = (orderId: string, note: string) =>
    fireAndRefresh(
      async () => {
        const res = await postJson('/api/orders/notes', { order_id: orderId, note });
        if (!res.ok) throw new Error(`Note save failed (${res.status})`);
      },
      'Note saved',
    );

  const assignBin = (orderId: string, bin: string) =>
    fireAndRefresh(
      async () => {
        const res = await postJson('/api/orders/assign-bin', { order_id: orderId, bin });
        if (!res.ok) throw new Error(`Bin assign failed (${res.status})`);
      },
      `Assigned to ${bin}`,
    );

  const markTested = (orderId: string, pass: boolean) =>
    fireAndRefresh(
      async () => {
        const res = await postJson('/api/tech/mark-tested', { order_id: orderId, result: pass ? 'PASS' : 'FAIL' });
        if (!res.ok) throw new Error(`Mark tested failed (${res.status})`);
      },
      pass ? 'Marked tested — PASS' : 'Marked tested — FAIL',
    );

  const markPacked = (orderId: string) =>
    fireAndRefresh(
      async () => {
        const res = await postJson('/api/pack/mark-packed', { order_id: orderId });
        if (!res.ok) throw new Error(`Mark packed failed (${res.status})`);
      },
      'Marked packed',
    );

  const printLabel = (orderId: string) =>
    fireAndRefresh(
      async () => {
        const res = await postJson('/api/print/shipping-label', { order_id: orderId });
        if (!res.ok) throw new Error(`Print failed (${res.status})`);
      },
      'Label sent to printer',
    );

  const quarantine = (orderId: string, reason: string) =>
    fireAndRefresh(
      async () => {
        // Quarantine is a station action initiated from an OPEN order
        // detail — NOT a receiving entry. It posts to /api/operations/quarantine,
        // which writes to inventory_events / orders_exceptions, not to
        // receiving_lines.
        const res = await postJson('/api/operations/quarantine', { order_id: orderId, reason });
        if (!res.ok) throw new Error(`Quarantine failed (${res.status})`);
      },
      'Order quarantined',
    );

  const router = (path: string) => {
    if (typeof window !== 'undefined') window.location.assign(path);
  };

  const actions = buildActions(commitNote, assignBin, markTested, markPacked, printLabel, quarantine, router)
    .filter((a) => a.visible(order));

  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    rows: actions.filter((a) => a.group === g),
  })).filter((g) => g.rows.length > 0);

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={`Order ${order.orderId}`}>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto pb-2">
          {grouped.map(({ group, rows }) => (
            <section key={group}>
              <h4 className="px-1 pb-1 text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">
                {GROUP_LABELS[group]}
              </h4>
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
                {rows.map((row, idx) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setConfirm(row)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors active:bg-gray-100 ${
                      idx < rows.length - 1 ? 'border-b border-gray-100' : ''
                    } ${row.destructive ? 'text-red-600' : 'text-gray-900'}`}
                  >
                    <span className="font-semibold">{row.label}</span>
                    <span className="text-xs text-gray-400" aria-hidden>›</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </BottomSheet>

      {confirm && (
        <ConfirmSheet
          open={!!confirm}
          onClose={() => setConfirm(null)}
          title={confirm.label}
          message={`Apply this action to order ${order.orderId}?`}
          confirmLabel={confirm.destructive ? 'Yes, do it' : 'Confirm'}
          destructive={!!confirm.destructive}
          onConfirm={async () => {
            const row = confirm;
            setConfirm(null);
            await row.run(order);
          }}
        />
      )}

      {promptOpen && (
        <PromptSheet
          open={!!promptOpen}
          onClose={() => setPromptOpen(null)}
          title={promptOpen.title}
          placeholder={promptOpen.placeholder}
          onCommit={(v) => { void promptOpen.commit(v); }}
        />
      )}
    </>
  );
}
