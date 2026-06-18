'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Copy, Check, X } from '@/components/Icons';
import { copyToClipboard } from '@/utils/_dom';
import { useActivityInbox } from '@/contexts/ActivityInboxContext';

interface ActivityInboxPopoverProps {
    onClose: () => void;
}

/**
 * Standalone inbox popover surfaced from the QuickAccess "Activity inbox"
 * action row. Mirrors the look of `PhoneHistoryPopover` so the QuickAccess
 * → secondary-popover flow stays visually consistent.
 *
 * Replaces the bottom-left `ActivityInboxDock`; that component is still
 * exported but no longer auto-mounted.
 */
export function ActivityInboxPopover({ onClose }: ActivityInboxPopoverProps) {
    const { items, dismissItem, clear } = useActivityInbox();
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
            className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
            <header className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-2">
                <div>
                    <p className="text-sm font-black text-gray-900">Recent activity</p>
                </div>
                <div className="flex items-center gap-2">
                    {items.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => clear()}
                            className="text-mini font-bold uppercase tracking-wide text-gray-500 hover:text-gray-800"
                        >
                            Clear
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="text-gray-400 hover:text-gray-700"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {items.length === 0 ? (
                    <p className="m-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-6 text-center text-caption italic text-gray-400">
                        No recent activity yet.
                    </p>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {items.map((it) => (
                            <li key={it.id} className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        {(() => {
                                            const href =
                                                it.kind === 'warranty_claim' && it.claimId
                                                    ? `/dashboard?warranty=&open=${it.claimId}`
                                                    : it.kind === 'return_pending_test'
                                                      ? '/tech'
                                                      : it.kind === 'order_ready_ship'
                                                        ? '/dashboard'
                                                        : null;
                                            const tone =
                                                it.kind === 'return_pending_test'
                                                    ? 'text-red-700 hover:text-red-900'
                                                    : 'text-blue-700 hover:text-blue-900';
                                            return href ? (
                                                <Link
                                                    href={href}
                                                    onClick={onClose}
                                                    className={`block truncate text-caption font-black hover:underline ${tone}`}
                                                >
                                                    {it.title}
                                                </Link>
                                            ) : (
                                                <p className="truncate text-caption font-black text-gray-900">
                                                    {it.title}
                                                </p>
                                            );
                                        })()}
                                        <p className="mt-0.5 whitespace-pre-wrap break-words text-mini font-medium leading-snug text-gray-600">
                                            {it.subtitle}
                                        </p>
                                        <p className="mt-1 text-micro font-bold uppercase tracking-wide text-gray-400">
                                            {formatDistanceToNowStrict(new Date(it.createdAt), {
                                                addSuffix: true,
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        {it.kind === 'staff_message' && it.body && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!it.body) return;
                                                    void handleCopyBack(it.body, it.id);
                                                }}
                                                aria-label="Copy message"
                                                title="Copy message"
                                                className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                            >
                                                {copiedId === it.id ? (
                                                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => dismissItem(it.id)}
                                            className="text-micro font-bold uppercase tracking-wide text-gray-400 hover:text-gray-700"
                                            aria-label="Dismiss"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
