'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Copy, Check, Send, X } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/utils/_dom';
import { toast } from '@/lib/toast';
import {
  useClipboardHistory,
  clearClipboardHistory,
  type ClipboardEntry,
} from '@/lib/clipboard-history';
import { StaffRecipientList, type StaffRecipient } from './StaffRecipientList';
import { CHIP_TONES } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';

interface ClipboardHistoryPopoverProps {
  onClose: () => void;
}

/** Accent dot for non-chip clipboard kinds only; chip kinds (id/tracking/serial/
 *  sku/fnsku/ticket) read their dot from the CHIP_TONES SoT. */
const EXTRA_DOT: Record<string, string> = {
  seller_claim: 'bg-blue-600',
};

function dotForKind(kind: string | null | undefined): string {
  if (!kind) return 'bg-gray-300';
  const chip = (CHIP_TONES as Record<string, { dot?: string }>)[kind];
  return chip?.dot ?? EXTRA_DOT[kind] ?? 'bg-gray-300';
}

function timeAgo(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

/**
 * Header clipboard popover — the device's recently-copied values (client-only,
 * see lib/clipboard-history). Each row can be re-copied or sent to a coworker's
 * inbox via the paper-airplane (POST /api/staff-messages → inbox:{staffId}).
 *
 * Mirrors PhoneHistoryPopover / ActivityInboxPopover styling so the header
 * popover family stays visually consistent.
 */
export function ClipboardHistoryPopover({ onClose }: ClipboardHistoryPopoverProps) {
  const { user } = useAuth();
  const entries = useClipboardHistory();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Which entry is in "pick a recipient" mode (null = none).
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRecipient[] | null>(null);
  const [sentToId, setSentToId] = useState<string | null>(null);

  // Lazy-load the staff list the first time a send picker opens.
  useEffect(() => {
    if (!sendingId || staff !== null) return;
    let cancelled = false;
    fetch('/api/auth/staff-picker', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { staff?: StaffRecipient[] } | null) => {
        if (cancelled) return;
        const list = (data?.staff ?? []).filter((s) => s.id !== user?.staffId);
        setStaff(list);
      })
      .catch(() => {
        if (!cancelled) setStaff([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sendingId, staff, user?.staffId]);

  const handleCopyAgain = useCallback(async (entry: ClipboardEntry) => {
    const ok = await copyToClipboard(entry.value, {
      recordHistory: true,
      historyKind: entry.kind,
      historyDisplay: entry.display,
      historySellerMessageId: entry.sellerMessageId,
    });
    if (ok) {
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1200);
    }
  }, []);

  const handleSend = useCallback(
    async (entry: ClipboardEntry, recipient: StaffRecipient) => {
      try {
        const isSellerClaim =
          entry.kind === 'seller_claim' &&
          typeof entry.sellerMessageId === 'number' &&
          entry.sellerMessageId > 0;
        const res = await fetch('/api/staff-messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientId: recipient.id,
            body: entry.value,
            kind: isSellerClaim ? 'seller_claim_message' : 'copied_text',
            context: isSellerClaim
              ? {
                  sellerMessageId: entry.sellerMessageId,
                  display: entry.display ?? `Seller msg #${entry.sellerMessageId}`,
                }
              : {
                  ...(entry.kind ? { tone: entry.kind } : {}),
                  ...(entry.display ? { display: entry.display } : {}),
                },
          }),
        });
        if (!res.ok) throw new Error('send failed');
        toast.success(`Sent to ${recipient.name}`);
        setSentToId(entry.id);
        setSendingId(null);
        window.setTimeout(() => setSentToId((s) => (s === entry.id ? null : s)), 1500);
      } catch {
        toast.error('Could not send');
      }
    },
    [],
  );

  return (
    <div
      role="dialog"
      aria-label="Clipboard history"
      className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-2">
        <div>
          <p className="text-micro font-black uppercase tracking-widest text-gray-500">
            Clipboard
          </p>
          <p className="mt-0.5 text-sm font-black text-gray-900">
            Recent copies · send to staff
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => clearClipboardHistory()}
              className="h-auto px-0 text-mini font-bold uppercase tracking-wide text-gray-500 hover:bg-transparent hover:text-gray-800"
            >
              Clear
            </Button>
          )}
          <IconButton
            ariaLabel="Close"
            onClick={onClose}
            icon={<X className="h-3.5 w-3.5" />}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="m-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-6 text-center text-caption italic text-gray-400">
            Copy a tracking #, serial, SKU or order # and it lands here — then
            send it to a teammate&apos;s inbox.
          </p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {entries.map((entry) => {
              const dot = dotForKind(entry.kind);
              const label = entry.display?.trim() || entry.value;
              const isSending = sendingId === entry.id;
              return (
                <li key={entry.id} className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <HoverTooltip label="Copy again" asChild>
                      {/* ds-raw-button: text-left multi-element copy-again row (dot + value + time + copy icon), not a single DS Button */}
                      <button
                        type="button"
                        onClick={() => handleCopyAgain(entry)}
                        aria-label="Copy again"
                        className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-label font-bold text-gray-900">
                            {label}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 text-micro text-gray-400">
                            <Clock className="h-3 w-3" />
                            {timeAgo(entry.ts)}
                          </span>
                        </span>
                        {copiedId === entry.id ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-gray-500" />
                        )}
                      </button>
                    </HoverTooltip>
                    <HoverTooltip label="Send to staff" asChild>
                      <IconButton
                        ariaLabel="Send to staff"
                        aria-expanded={isSending}
                        onClick={() => setSendingId((s) => (s === entry.id ? null : entry.id))}
                        className={`group flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          isSending ? 'bg-blue-600' : 'hover:bg-gray-100'
                        }`}
                        icon={
                          sentToId === entry.id ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Send
                              className={`h-4 w-4 ${
                                isSending ? 'text-white' : 'text-gray-400 group-hover:text-blue-600'
                              }`}
                            />
                          )
                        }
                      />
                    </HoverTooltip>
                  </div>

                  {isSending && (
                    <div className="mt-1 rounded-lg border border-gray-100 bg-gray-50/60 p-1.5">
                      <p className="px-1 pb-1 text-micro font-black uppercase tracking-widest text-gray-500">
                        Send to…
                      </p>
                      {staff === null ? (
                        <div className="flex items-center justify-center py-3">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                        </div>
                      ) : (
                        <StaffRecipientList
                          staff={staff}
                          onPick={(recipient) => handleSend(entry, recipient)}
                          currentStaffId={null}
                          emptyLabel="No other staff to send to."
                          title="Send to…"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
