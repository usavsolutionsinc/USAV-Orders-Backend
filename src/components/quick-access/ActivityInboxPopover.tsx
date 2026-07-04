'use client';

import Link from 'next/link';
import { useMemo, useState, type ComponentType } from 'react';
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

interface ActivityInboxPopoverProps {
    onClose: () => void;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Presentation layer — render structured item fields as scannable chips/tones
 * instead of cramming everything into the title/subtitle strings. One-row
 * anatomy per the house style: leading tone-icon → eyebrow+time → title → chips.
 * ────────────────────────────────────────────────────────────────────────── */

type Tone = 'blue' | 'amber' | 'emerald' | 'rose' | 'violet' | 'gray';
type Glyph = ComponentType<{ className?: string }>;

// Full literal class strings (Tailwind can't see interpolated `bg-${tone}-50`).
const TILE_TONE: Record<Tone, string> = {
    blue: 'bg-blue-50 text-blue-600 ring-blue-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    rose: 'bg-rose-50 text-rose-600 ring-rose-100',
    violet: 'bg-violet-50 text-violet-600 ring-violet-100',
    gray: 'bg-surface-canvas text-text-soft ring-border-hairline',
};

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

/** Primary tabs — always shown (matches goal-chip segmented row). */
const PRIMARY_INBOX_TABS: InboxTabId[] = ['all', 'tech_queue', 'repair', 'support', 'messages'];

function inboxTabFor(it: ActivityInboxItem): InboxTabId {
    return INBOX_TAB_FOR_KIND[it.kind];
}

/** Compact relative time — "16 hrs ago" instead of "16 hours ago". */
function inboxRelativeTime(ms: number): string {
    return formatDistanceToNowStrict(new Date(ms), { addSuffix: true })
        .replace(/\bhours ago\b/, 'hrs ago')
        .replace(/\bhour ago\b/, 'hr ago')
        .replace(/\bminutes ago\b/, 'mins ago')
        .replace(/\bminute ago\b/, 'min ago');
}

/** Text after the first " · " divider (drops the kind prefix from a title). */
function afterSep(title: string): string {
    const i = title.indexOf(' · ');
    return i >= 0 ? title.slice(i + 3) : title;
}

/** Human identity line for a row — uses structured fields, falls back to title. */
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

/** Map a lifecycle/status word to a chip tone. */
function statusTone(status: string): Tone {
    const v = status.toLowerCase();
    if (/(approv|repaired|repair_logged|closed|done|complete|received|ready|ship)/.test(v)) return 'emerald';
    if (/(deni|expire|fail|error|block|reject|cancel)/.test(v)) return 'rose';
    if (/(submit|pending|progress|in_repair|await|test|open)/.test(v)) return 'blue';
    return 'gray';
}

/** Deep-link map — resolve each item to the most precise record view available. */
function hrefFor(it: ActivityInboxItem): string | null {
    if (it.kind === 'support_followup' && it.ticketId) {
        return `/support?ticket=${it.ticketId}`;
    }
    if (it.kind === 'warranty_claim' && it.claimId) return `/dashboard?warranty=&open=${it.claimId}`;
    // Receiving-carton kinds carry a `receiving.id`. Route straight to the exact
    // carton/line workspace — `useReceivingDeepLink` reads `?recvId=` and opens
    // the right pane (title, PO#, SKU, tracking, condition + test badge) — instead
    // of dumping the user on a generic `/tech` or `/dashboard` landing.
    if (
        (it.kind === 'order_ready_ship' ||
            it.kind === 'return_pending_test' ||
            it.kind === 'priority_unbox') &&
        it.receivingId
    ) {
        const line = it.lineId ? `&lineId=${it.lineId}` : '';
        return `/receiving?recvId=${it.receivingId}${line}`;
    }
    // Fallbacks when no carton id is present on the item.
    if (it.kind === 'return_pending_test') return '/tech';
    if (it.kind === 'order_ready_ship') return '/dashboard';
    return null;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
    return (
        <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-mini font-black uppercase tracking-wide ring-1 ring-inset ${PILL_TONE[tone]}`}
        >
            {children}
        </span>
    );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Standalone inbox popover surfaced from the top-bar notifications bell.
 * Linear/Notion-style: one tone-coded row per item, full-row click target,
 * structured chips (tracking / status transition / claim status), and an
 * inline Undo for reversible repair changes within their TTL window.
 */
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
        () =>
            activeTab === 'all'
                ? items
                : items.filter((it) => inboxTabFor(it) === activeTab),
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
        <div
            role="dialog"
            aria-label="Recent activity inbox"
            className="flex max-h-[calc(100vh-6rem)] w-[360px] flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card shadow-xl"
        >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-hairline px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
                        Recent activity
                    </p>
                    {items.length > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-surface-inverse px-1 text-mini font-bold leading-none text-white tabular-nums">
                            {items.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {items.length > 0 ? (
                        <Button
                            variant="ghost"
                            onClick={() => clear()}
                            className="-my-1 h-auto px-1.5 py-1 text-mini font-bold uppercase tracking-wide text-text-soft hover:bg-surface-sunken hover:text-text-default"
                        >
                            Clear all
                        </Button>
                    ) : null}
                    <IconButton ariaLabel="Close" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} />
                </div>
            </header>

            {/* Segmented type filter — same pill track as GoalPopover (header goal chip). */}
            <div className="shrink-0 border-b border-border-hairline px-3 py-2">
                <div
                    role="tablist"
                    aria-label="Inbox type"
                    className="flex w-full items-center gap-0.5 rounded-xl bg-surface-sunken p-0.5 ring-1 ring-border-soft"
                >
                    {tabItems.map((tabId) => {
                        const active = activeTab === tabId;
                        const count = tabId === 'all' ? tabCounts.all : tabCounts[tabId];
                        // ds-raw-button
                        return (
                            <button
                                key={tabId}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setActiveTab(tabId)}
                                className={cn(
                                    'relative flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-micro font-bold transition-colors',
                                    active
                                        ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft'
                                        : 'text-text-soft hover:text-text-default',
                                )}
                            >
                                <span className="truncate">{INBOX_TAB_LABEL[tabId]}</span>
                                {count > 0 ? (
                                    <span
                                        className={cn(
                                            'shrink-0 tabular-nums',
                                            active ? 'text-text-soft' : 'text-text-faint',
                                        )}
                                    >
                                        {count}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {tabEmpty ? (
                    <div className="flex flex-col items-center px-6 py-10 text-center">
                        <p className="text-mini font-medium text-text-faint">
                            {TAB_EMPTY_COPY[activeTab] ?? `No ${INBOX_TAB_LABEL[activeTab].toLowerCase()} items`}
                        </p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-canvas text-text-faint ring-1 ring-inset ring-border-hairline">
                            <Inbox className="h-5 w-5" />
                        </span>
                        <p className="text-caption font-bold text-text-muted">You&apos;re all caught up</p>
                        <p className="max-w-[14rem] text-mini font-medium leading-snug text-text-faint">
                            New tech items, repair updates, and messages will land here.
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
                                <li key={it.id} className="group relative hover:bg-surface-canvas/70">
                                    {navigable && (
                                        <Link
                                            href={href}
                                            onClick={onClose}
                                            aria-label={`${meta.label}: ${primary}`}
                                            className="absolute inset-0 z-0"
                                        />
                                    )}
                                    <div
                                        className={`relative flex items-start gap-2.5 px-3 py-2.5 ${
                                            navigable ? 'pointer-events-none' : ''
                                        }`}
                                    >
                                        {/* Leading tone icon */}
                                        <span
                                            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${TILE_TONE[meta.tone]}`}
                                        >
                                            <Icon className="h-3.5 w-3.5" />
                                        </span>

                                        {/* Body — row 1: title only; row 2: time + chips */}
                                        <div className="min-w-0 flex-1">
                                            <p
                                                className={`truncate text-caption font-black ${
                                                    navigable
                                                        ? 'text-text-default group-hover:text-blue-700'
                                                        : 'text-text-default'
                                                }`}
                                            >
                                                {primary}
                                            </p>

                                            <div className="mt-1 flex flex-wrap items-center gap-1">
                                                <span className="shrink-0 whitespace-nowrap text-mini font-semibold text-text-faint">
                                                    {inboxRelativeTime(it.createdAt)}
                                                </span>

                                                {(it.kind === 'order_ready_ship' ||
                                                    it.kind === 'return_pending_test') && (
                                                    <Pill
                                                        tone={
                                                            it.kind === 'order_ready_ship'
                                                                ? 'emerald'
                                                                : 'rose'
                                                        }
                                                    >
                                                        {it.kind === 'order_ready_ship'
                                                            ? 'Ready to ship'
                                                            : 'Needs testing'}
                                                    </Pill>
                                                )}

                                                {it.kind === 'support_followup' && (
                                                    <>
                                                        <Pill tone="violet">Follow up</Pill>
                                                        {it.ticketId ? (
                                                            <Pill tone="gray">#{it.ticketId}</Pill>
                                                        ) : null}
                                                        {it.assignedStaffId != null ? (
                                                            <Pill tone="blue">
                                                                {it.assignedStaffName ?? 'Staff'} ·{' '}
                                                                {it.assignedStaffId}
                                                            </Pill>
                                                        ) : null}
                                                    </>
                                                )}

                                                {it.orderNumber && (
                                                    <span className="pointer-events-auto relative z-10 inline-flex max-w-full">
                                                        <OrderIdChip
                                                            value={it.orderNumber}
                                                            display={getLast4(it.orderNumber)}
                                                            dense
                                                        />
                                                    </span>
                                                )}

                                                {it.trackingNumber && (
                                                    <span className="pointer-events-auto relative z-10 inline-flex max-w-full">
                                                        <TrackingChip
                                                            value={it.trackingNumber}
                                                            display={getLast4(it.trackingNumber)}
                                                            dense
                                                        />
                                                    </span>
                                                )}

                                                {it.kind === 'repair_status' &&
                                                    (it.previousStatus || it.nextStatus) && (
                                                        <>
                                                            {it.previousStatus ? (
                                                                <Pill tone="gray">{it.previousStatus}</Pill>
                                                            ) : null}
                                                            <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
                                                            {it.nextStatus ? (
                                                                <Pill tone={statusTone(it.nextStatus)}>
                                                                    {it.nextStatus}
                                                                </Pill>
                                                            ) : null}
                                                        </>
                                                    )}

                                                {it.kind === 'warranty_claim' && it.claimStatus && (
                                                    <Pill tone={statusTone(it.claimStatus)}>{it.claimStatus}</Pill>
                                                )}

                                                {it.kind === 'priority_unbox' && it.sku && (
                                                    <Pill tone="violet">{it.sku}</Pill>
                                                )}
                                            </div>

                                            {/* Message body — the one kind whose subtitle IS the content */}
                                            {it.kind === 'staff_message' && it.body && (
                                                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-mini font-medium leading-snug text-text-soft">
                                                    {it.body}
                                                </p>
                                            )}

                                            {/* Undo lifecycle (reversible repair changes) */}
                                            {it.kind === 'repair_status' && (it.undone || it.undoFailed) && (
                                                <p
                                                    className={`mt-1 text-mini font-bold uppercase tracking-wide ${
                                                        it.undoFailed ? 'text-rose-600' : 'text-text-faint'
                                                    }`}
                                                >
                                                    {it.undoFailed ? 'Undo failed' : 'Reverted'}
                                                </p>
                                            )}
                                        </div>

                                        {/* Right actions */}
                                        <div className="pointer-events-auto relative z-10 flex shrink-0 items-center gap-0.5">
                                            {undoable && (
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => void undoItem(it.id)}
                                                    disabled={undoing}
                                                    className="-my-1 h-auto gap-1 px-1.5 py-1 text-micro font-bold uppercase tracking-wide text-text-soft hover:bg-surface-sunken hover:text-text-default"
                                                >
                                                    {undoing ? (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    ) : (
                                                        <RotateCcw className="h-3 w-3" />
                                                    )}
                                                    Undo
                                                </Button>
                                            )}

                                            {it.kind === 'staff_message' && it.body && (
                                                <HoverTooltip label="Copy message" asChild>
                                                    <IconButton
                                                        ariaLabel="Copy message"
                                                        onClick={() => {
                                                            if (!it.body) return;
                                                            void handleCopyBack(it.body, it.id);
                                                        }}
                                                        className="group/copy flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-sunken"
                                                        icon={
                                                            copiedId === it.id ? (
                                                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                                            ) : (
                                                                <Copy className="h-3.5 w-3.5 text-text-faint group-hover/copy:text-text-muted" />
                                                            )
                                                        }
                                                    />
                                                </HoverTooltip>
                                            )}

                                            <HoverTooltip label="Dismiss" asChild>
                                                <IconButton
                                                    ariaLabel="Dismiss"
                                                    onClick={() => dismissItem(it.id)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-faint opacity-0 hover:bg-surface-sunken hover:text-text-muted focus-visible:opacity-100 group-hover:opacity-100"
                                                    icon={<X className="h-3.5 w-3.5" />}
                                                />
                                            </HoverTooltip>

                                            {navigable && (
                                                <ChevronRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-text-faint" />
                                            )}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
}
