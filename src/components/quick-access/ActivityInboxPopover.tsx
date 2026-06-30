'use client';

import Link from 'next/link';
import { useState, type ComponentType } from 'react';
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
    gray: 'bg-gray-50 text-gray-500 ring-gray-100',
};

const PILL_TONE: Record<Tone, string> = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    gray: 'bg-gray-100 text-gray-600 ring-gray-200',
};

const KIND_META: Record<ActivityInboxItemKind, { label: string; Icon: Glyph; tone: Tone }> = {
    repair_status: { label: 'Repair', Icon: Wrench, tone: 'amber' },
    priority_unbox: { label: 'Priority', Icon: Zap, tone: 'violet' },
    warranty_claim: { label: 'Warranty', Icon: ShieldCheck, tone: 'emerald' },
    return_pending_test: { label: 'Tech queue', Icon: RotateCcw, tone: 'rose' },
    order_ready_ship: { label: 'Tech queue', Icon: Truck, tone: 'blue' },
    staff_message: { label: 'Message', Icon: MessageSquare, tone: 'blue' },
};

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
            className="flex max-h-[calc(100vh-6rem)] w-[360px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
                        Recent activity
                    </p>
                    {items.length > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gray-900 px-1 text-mini font-bold leading-none text-white tabular-nums">
                            {items.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {items.length > 0 ? (
                        <Button
                            variant="ghost"
                            onClick={() => clear()}
                            className="-my-1 h-auto px-1.5 py-1 text-mini font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                        >
                            Clear all
                        </Button>
                    ) : null}
                    <IconButton ariaLabel="Close" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} />
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {items.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 text-gray-300 ring-1 ring-inset ring-gray-100">
                            <Inbox className="h-5 w-5" />
                        </span>
                        <p className="text-caption font-bold text-gray-700">You&apos;re all caught up</p>
                        <p className="max-w-[14rem] text-mini font-medium leading-snug text-gray-400">
                            New tech-queue items, repair updates, and messages will land here.
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {items.map((it) => {
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
                                <li key={it.id} className="group relative hover:bg-gray-50/70">
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

                                        {/* Body */}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 text-eyebrow font-bold uppercase tracking-widest text-gray-400">
                                                <span className="truncate">{meta.label}</span>
                                                <span aria-hidden className="text-gray-300">
                                                    ·
                                                </span>
                                                <span className="shrink-0 whitespace-nowrap normal-case tracking-wide">
                                                    {formatDistanceToNowStrict(new Date(it.createdAt), {
                                                        addSuffix: true,
                                                    })}
                                                </span>
                                            </div>

                                            <p
                                                className={`mt-0.5 truncate text-caption font-black ${
                                                    navigable
                                                        ? 'text-gray-900 group-hover:text-blue-700'
                                                        : 'text-gray-900'
                                                }`}
                                            >
                                                {primary}
                                            </p>

                                            {/* Structured chips */}
                                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                                {it.kind === 'repair_status' &&
                                                    (it.previousStatus || it.nextStatus) && (
                                                        <>
                                                            {it.previousStatus ? (
                                                                <Pill tone="gray">{it.previousStatus}</Pill>
                                                            ) : null}
                                                            <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
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

                                                {it.orderNumber && (
                                                    <span className="pointer-events-auto relative z-10 inline-flex max-w-full">
                                                        <OrderIdChip
                                                            value={it.orderNumber}
                                                            display={it.orderNumber}
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
                                            </div>

                                            {/* Message body — the one kind whose subtitle IS the content */}
                                            {it.kind === 'staff_message' && it.body && (
                                                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-mini font-medium leading-snug text-gray-500">
                                                    {it.body}
                                                </p>
                                            )}

                                            {/* Undo lifecycle (reversible repair changes) */}
                                            {it.kind === 'repair_status' && (it.undone || it.undoFailed) && (
                                                <p
                                                    className={`mt-1 text-mini font-bold uppercase tracking-wide ${
                                                        it.undoFailed ? 'text-rose-600' : 'text-gray-400'
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
                                                    className="-my-1 h-auto gap-1 px-1.5 py-1 text-micro font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-100 hover:text-gray-800"
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
                                                        className="group/copy flex h-7 w-7 items-center justify-center rounded-md hover:bg-gray-100"
                                                        icon={
                                                            copiedId === it.id ? (
                                                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                                            ) : (
                                                                <Copy className="h-3.5 w-3.5 text-gray-400 group-hover/copy:text-gray-700" />
                                                            )
                                                        }
                                                    />
                                                </HoverTooltip>
                                            )}

                                            <HoverTooltip label="Dismiss" asChild>
                                                <IconButton
                                                    ariaLabel="Dismiss"
                                                    onClick={() => dismissItem(it.id)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-md text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100 group-hover:opacity-100"
                                                    icon={<X className="h-3.5 w-3.5" />}
                                                />
                                            </HoverTooltip>

                                            {navigable && (
                                                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-400" />
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
