'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Send, Loader2 } from '@/components/Icons';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/utils/_dom';
import { toast } from '@/lib/toast';
import {
  useClipboardHistory,
  clearClipboardHistory,
  type ClipboardEntry,
} from '@/lib/clipboard-history';
import { resolveClipboardEntryMeta } from '@/lib/clipboard-entry-meta';
import { StaffRecipientList, type StaffRecipient } from './StaffRecipientList';
import { CHIP_TONES } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { QuickAccessPanelShell } from './QuickAccessPanelShell';

interface ClipboardHistoryPopoverProps {
  onClose: () => void;
}

const EXTRA_DOT: Record<string, string> = {
  seller_claim: 'bg-blue-600',
};

function dotForKind(kind: string | null | undefined): string {
  if (!kind) return 'bg-surface-strong';
  const chip = (CHIP_TONES as Record<string, { dot?: string }>)[kind];
  return chip?.dot ?? EXTRA_DOT[kind] ?? 'bg-surface-strong';
}

function timeAgo(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function ClipboardHistoryPopover({ onClose }: ClipboardHistoryPopoverProps) {
  const { user } = useAuth();
  const entries = useClipboardHistory();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRecipient[] | null>(null);
  const [sentToId, setSentToId] = useState<string | null>(null);

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
    <QuickAccessPanelShell
      title="Clipboard"
      subtitle="Recent copies · send to staff"
      ariaLabel="Clipboard history"
      onClose={onClose}
      count={entries.length}
      bodyClassName="px-0 py-0"
      headerActions={
        entries.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearClipboardHistory()}
            className="text-caption font-semibold text-text-soft hover:text-text-default"
          >
            Clear
          </Button>
        ) : null
      }
    >
      {entries.length === 0 ? (
        <p className="mx-3 my-3 rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-soft">
          Copy a tracking #, serial, SKU, or order # and it lands here — then send it to a teammate&apos;s inbox.
        </p>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {entries.map((entry) => {
            const dot = dotForKind(entry.kind);
            const value = entry.value;
            const meta = resolveClipboardEntryMeta(entry, timeAgo);
            const isSending = sendingId === entry.id;

            return (
              <li key={entry.id} className="px-2 py-1">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCopyAgain(entry)}
                    aria-label={`Copy ${value} again`}
                    className="group flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-sunken"
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all text-caption font-bold text-text-default">
                        {value}
                      </span>
                      {meta.tags.length > 0 || meta.time ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-eyebrow font-semibold uppercase tracking-widest">
                          <span className="shrink-0 text-text-faint">{meta.time}</span>
                          {meta.tags.map((tag) => (
                            <span key={tag} className="text-text-soft">
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    {copiedId === entry.id ? (
                      <Check className="mt-1.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <Copy className="mt-1.5 h-3.5 w-3.5 shrink-0 text-text-faint group-hover:text-text-muted" />
                    )}
                  </button>

                  <HoverTooltip label="Send to staff" asChild>
                    <IconButton
                      ariaLabel="Send to staff"
                      aria-expanded={isSending}
                      onClick={() => setSendingId((s) => (s === entry.id ? null : entry.id))}
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                        isSending
                          ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                          : 'hover:bg-surface-sunken',
                      )}
                      icon={
                        sentToId === entry.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Send
                            className={cn(
                              'h-3.5 w-3.5',
                              isSending ? 'text-blue-700' : 'text-text-faint hover:text-blue-600',
                            )}
                          />
                        )
                      }
                    />
                  </HoverTooltip>
                </div>

                {isSending ? (
                  <div className="mx-1 mb-1 mt-0.5 rounded-lg border border-border-hairline bg-surface-canvas/60 p-1.5">
                    {staff === null ? (
                      <div className="flex items-center justify-center gap-2 py-3 text-caption text-text-soft">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading staff…
                      </div>
                    ) : (
                      <StaffRecipientList
                        staff={staff}
                        onPick={(recipient) => void handleSend(entry, recipient)}
                        currentStaffId={null}
                        emptyLabel="No other staff to send to."
                        title="Send to…"
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </QuickAccessPanelShell>
  );
}
