'use client';

import Link from 'next/link';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Copy,
  Check,
  X,
  Inbox,
  Wrench,
  Zap,
  ShieldCheck,
  RotateCcw,
  Truck,
  MessageSquare,
  Phone,
  ChevronRight,
  Loader2,
} from '@/components/Icons';
import { copyToClipboard } from '@/utils/_dom';
import {
  useActivityInbox,
  type ActivityInboxItem,
  type ActivityInboxItemKind,
} from '@/contexts/ActivityInboxContext';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TrackingChip, OrderIdChip, getLast4 } from '@/components/ui/CopyChip';
import { Button, IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { QuickAccessPanelShell } from './QuickAccessPanelShell';

interface ActivityInboxPopoverProps {
  onClose: () => void;
}

type Tone = 'blue' | 'amber' | 'emerald' | 'rose' | 'violet' | 'gray';
type Glyph = ComponentType<{ className?: string }>;

const PILL_TONE: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  gray: 'bg-surface-sunken text-text-muted ring-border-soft',
};

const KIND_META: Record<ActivityInboxItemKind, { label: string; Icon: Glyph; tone: Tone }> = {
  repair_status: { label: 'Repair', Icon: Wrench, tone: 'amber' },
  priority_unbox: { label: 'Priority', Icon: Zap, tone: 'violet' },
  warranty_claim: { label: 'Warranty', Icon: ShieldCheck, tone: 'emerald' },
  return_pending_test: { label: 'Tech', Icon: RotateCcw, tone: 'rose' },
  order_ready_ship: { label: 'Tech', Icon: Truck, tone: 'blue' },
  support_followup: { label: 'Support', Icon: Phone, tone: 'violet' },
  staff_message: { label: 'Message', Icon: MessageSquare, tone: 'blue' },
};

type InboxTabId = 'all' | 'tech_queue' | 'repair' | 'support' | 'warranty' | 'priority' | 'messages';

const INBOX_TAB_FOR_KIND: Record<ActivityInboxItemKind, InboxTabId> = {
  return_pending_test: 'tech_queue',
  order_ready_ship: 'tech_queue',
  repair_status: 'repair',
  warranty_claim: 'warranty',
  priority_unbox: 'priority',
  support_followup: 'support',
  staff_message: 'messages',
};

const INBOX_TAB_LABEL: Record<InboxTabId, string> = {
  all: 'All',
  tech_queue: 'Tech',
  repair: 'Repair',
  support: 'Support',
  warranty: 'Warranty',
  priority: 'Priority',
  messages: 'Messages',
};

const TAB_EMPTY_COPY: Partial<Record<InboxTabId, string>> = {
  tech_queue: 'No tech items',
  repair: 'No repair updates',
  support: 'No support follow-ups',
  messages: 'No messages',
};

const PRIMARY_INBOX_TABS: InboxTabId[] = ['all', 'tech_queue', 'repair', 'support', 'messages'];

function inboxTabFor(it: ActivityInboxItem): InboxTabId {
  return INBOX_TAB_FOR_KIND[it.kind];
}

function inboxRelativeTime(ms: number): string {
  return formatDistanceToNowStrict(new Date(ms), { addSuffix: true })
    .replace(/\bhours ago\b/, 'hrs ago')
    .replace(/\bhour ago\b/, 'hr ago')
    .replace(/\bminutes ago\b/, 'mins ago')
    .replace(/\bminute ago\b/, 'min ago');
}

function afterSep(title: string): string {
  const i = title.indexOf(' · ');
  return i >= 0 ? title.slice(i + 3) : title;
}

function primaryFor(it: ActivityInboxItem): string {
  switch (it.kind) {
    case 'order_ready_ship':
      return it.productTitle?.trim() || 'Ready to ship';
    case 'return_pending_test':
      return it.productTitle?.trim() || 'Needs testing';
    case 'support_followup':
      return it.ticketSubject?.trim() || (it.ticketId ? `Ticket #${it.ticketId}` : 'Support follow-up');
    case 'priority_unbox':
      return 'Unbox this first';
    case 'warranty_claim':
      return it.claimNumber || afterSep(it.title);
    case 'repair_status':
    case 'staff_message':
    default:
      return afterSep(it.title);
  }
}

function statusTone(status: string): Tone {
  const v = status.toLowerCase();
  if (/(approv|repaired|repair_logged|closed|done|complete|received|ready|ship)/.test(v)) return 'emerald';
  if (/(deni|expire|fail|error|block|reject|cancel)/.test(v)) return 'rose';
  if (/(submit|pending|progress|in_repair|await|test|open)/.test(v)) return 'blue';
  return 'gray';
}

function hrefFor(it: ActivityInboxItem): string | null {
  if (it.kind === 'support_followup' && it.ticketId) {
    return `/support?ticket=${it.ticketId}`;
  }
  if (it.kind === 'warranty_claim' && it.claimId) return `/dashboard?warranty=&open=${it.claimId}`;
  if (
    (it.kind === 'order_ready_ship' ||
      it.kind === 'return_pending_test' ||
      it.kind === 'priority_unbox') &&
    it.receivingId
  ) {
    const line = it.lineId ? `&lineId=${it.lineId}` : '';
    // The Unbox surface (`/unbox`) is where a carton is worked; `?recvId=` focuses it.
    return `/unbox?recvId=${it.receivingId}${line}`;
  }
  if (it.kind === 'return_pending_test') return '/test';
  if (it.kind === 'order_ready_ship') return '/dashboard';
  return null;
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-micro font-black uppercase tracking-widest ring-1 ring-inset',
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

function InboxTabs({
  tabs,
  activeTab,
  tabCounts,
  onChange,
}: {
  tabs: InboxTabId[];
  activeTab: InboxTabId;
  tabCounts: Record<InboxTabId, number>;
  onChange: (tab: InboxTabId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter notifications"
      className="flex gap-1 rounded-lg border border-border-hairline bg-surface-canvas p-0.5"
    >
      {tabs.map((tabId) => {
        const active = activeTab === tabId;
        const count = tabId === 'all' ? tabCounts.all : tabCounts[tabId];
        return (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tabId)}
            className={cn(
              'ds-raw-button flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-caption font-semibold transition-colors',
              active
                ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft'
                : 'text-text-soft hover:text-text-muted',
            )}
          >
            <span className="truncate">{INBOX_TAB_LABEL[tabId]}</span>
            {count > 0 ? (
              <span className={cn('shrink-0 tabular-nums', active ? 'text-text-soft' : 'text-text-faint')}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ActivityInboxPopover({ onClose }: ActivityInboxPopoverProps) {
  const { items, dismissItem, clear, undoItem, pendingUndoId } = useActivityInbox();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InboxTabId>('all');

  const tabCounts = useMemo(() => {
    const counts: Record<InboxTabId, number> = {
      all: items.length,
      tech_queue: 0,
      repair: 0,
      support: 0,
      warranty: 0,
      priority: 0,
      messages: 0,
    };
    for (const it of items) {
      counts[inboxTabFor(it)] += 1;
    }
    return counts;
  }, [items]);

  const tabItems = useMemo((): InboxTabId[] => {
    const tabs: InboxTabId[] = [...PRIMARY_INBOX_TABS];
    if (tabCounts.warranty > 0) tabs.push('warranty');
    if (tabCounts.priority > 0) tabs.push('priority');
    return tabs;
  }, [tabCounts.warranty, tabCounts.priority]);

  const visibleItems = useMemo(
    () => (activeTab === 'all' ? items : items.filter((it) => inboxTabFor(it) === activeTab)),
    [items, activeTab],
  );

  const tabEmpty = activeTab !== 'all' && visibleItems.length === 0;

  const handleCopyBack = async (body: string, id: string) => {
    const ok = await copyToClipboard(body);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    }
  };

  return (
    <QuickAccessPanelShell
      title="Recent activity"
      ariaLabel="Recent activity inbox"
      onClose={onClose}
      widthClass="w-[380px]"
      bodyClassName="px-0 py-0"
      headerActions={
        items.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clear()}
            className="h-7 px-2 text-caption font-semibold leading-none text-text-soft hover:text-text-default"
          >
            Clear all
          </Button>
        ) : null
      }
      toolbar={
        items.length > 0 ? (
          <InboxTabs
            tabs={tabItems}
            activeTab={activeTab}
            tabCounts={tabCounts}
            onChange={setActiveTab}
          />
        ) : null
      }
    >
      {tabEmpty ? (
        <p className="px-4 py-10 text-center text-caption text-text-soft">
          {TAB_EMPTY_COPY[activeTab] ?? `No ${INBOX_TAB_LABEL[activeTab].toLowerCase()} items`}
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Inbox className="h-5 w-5 text-text-faint" />
          <p className="text-sm font-semibold text-text-default">All caught up</p>
          <p className="max-w-[14rem] text-caption text-text-soft">
            Tech items, repair updates, and messages will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border-hairline">
          {visibleItems.map((it) => {
            const meta = KIND_META[it.kind];
            const Icon = meta.Icon;
            const href = hrefFor(it);
            const navigable = href != null;
            const primary = primaryFor(it);

            const undoable =
              it.kind === 'repair_status' &&
              !it.undone &&
              !it.undoFailed &&
              !!it.repairId &&
              it.undoUntil > Date.now();
            const undoing = pendingUndoId === it.id;

            return (
              <li key={it.id} className="group relative">
                {navigable ? (
                  <Link
                    href={href}
                    onClick={onClose}
                    aria-label={`${meta.label}: ${primary}`}
                    className="absolute inset-0 z-0"
                  />
                ) : null}
                <div
                  className={cn(
                    'relative flex items-start gap-2.5 px-3 py-2 transition-colors group-hover:bg-surface-hover',
                    navigable && 'pointer-events-none',
                  )}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-text-muted">
                    <Icon className="h-5 w-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-caption font-bold text-text-default',
                        navigable && 'group-hover:text-blue-700',
                      )}
                    >
                      {primary}
                    </p>

                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="shrink-0 text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                        {inboxRelativeTime(it.createdAt)}
                      </span>

                      {(it.kind === 'order_ready_ship' || it.kind === 'return_pending_test') && (
                        it.kind === 'order_ready_ship' ? (
                          <span className="pointer-events-auto relative z-10 inline-flex shrink-0">
                            <HoverTooltip label="Ready to ship" asChild focusable={false}>
                              <span className="inline-flex items-center text-emerald-600">
                                <Check className="h-4 w-4" aria-hidden />
                              </span>
                            </HoverTooltip>
                          </span>
                        ) : (
                          <Pill tone="rose">Needs testing</Pill>
                        )
                      )}

                      {it.kind === 'support_followup' && (
                        <>
                          <Pill tone="violet">Follow up</Pill>
                          {it.ticketId ? <Pill tone="gray">#{it.ticketId}</Pill> : null}
                        </>
                      )}

                      {it.orderNumber ? (
                        <span className="pointer-events-auto relative z-10 inline-flex max-w-full">
                          <OrderIdChip
                            value={it.orderNumber}
                            display={getLast4(it.orderNumber)}
                            dense
                          />
                        </span>
                      ) : null}

                      {it.trackingNumber ? (
                        <span className="pointer-events-auto relative z-10 inline-flex max-w-full">
                          <TrackingChip
                            value={it.trackingNumber}
                            display={getLast4(it.trackingNumber)}
                            dense
                          />
                        </span>
                      ) : null}

                      {it.kind === 'repair_status' && (it.previousStatus || it.nextStatus) ? (
                        <>
                          {it.previousStatus ? <Pill tone="gray">{it.previousStatus}</Pill> : null}
                          <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
                          {it.nextStatus ? (
                            <Pill tone={statusTone(it.nextStatus)}>{it.nextStatus}</Pill>
                          ) : null}
                        </>
                      ) : null}

                      {it.kind === 'warranty_claim' && it.claimStatus ? (
                        <Pill tone={statusTone(it.claimStatus)}>{it.claimStatus}</Pill>
                      ) : null}

                      {it.kind === 'priority_unbox' && it.sku ? (
                        <Pill tone="violet">{it.sku}</Pill>
                      ) : null}
                    </div>

                    {it.kind === 'staff_message' && it.body ? (
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-caption text-text-soft">
                        {it.body}
                      </p>
                    ) : null}

                    {it.kind === 'repair_status' && (it.undone || it.undoFailed) ? (
                      <p
                        className={cn(
                          'mt-1 text-eyebrow font-semibold uppercase tracking-widest',
                          it.undoFailed ? 'text-rose-600' : 'text-text-faint',
                        )}
                      >
                        {it.undoFailed ? 'Undo failed' : 'Reverted'}
                      </p>
                    ) : null}
                  </div>

                  <div className="pointer-events-auto relative z-10 flex shrink-0 items-center gap-0.5">
                    {undoable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void undoItem(it.id)}
                        disabled={undoing}
                        className="h-7 px-1.5 text-micro font-semibold text-text-soft"
                      >
                        {undoing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Undo
                      </Button>
                    ) : null}

                    {it.kind === 'staff_message' && it.body ? (
                      <HoverTooltip label="Copy message" asChild>
                        <IconButton
                          ariaLabel="Copy message"
                          onClick={() => {
                            if (!it.body) return;
                            void handleCopyBack(it.body, it.id);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-sunken"
                          icon={
                            copiedId === it.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-text-faint" />
                            )
                          }
                        />
                      </HoverTooltip>
                    ) : null}

                    <HoverTooltip label="Dismiss" asChild>
                      <IconButton
                        ariaLabel="Dismiss"
                        onClick={() => dismissItem(it.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint opacity-0 hover:bg-surface-sunken hover:text-text-muted focus-visible:opacity-100 group-hover:opacity-100"
                        icon={<X className="h-3.5 w-3.5" />}
                      />
                    </HoverTooltip>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </QuickAccessPanelShell>
  );
}
