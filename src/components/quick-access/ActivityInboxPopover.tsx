'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ClipboardList, X } from '@/components/Icons';
import {
    useActivityInbox,
    type ActivityInboxItem,
} from '@/contexts/ActivityInboxContext';

interface ActivityInboxPopoverProps {
    onClose: () => void;
}

function canShowUndo(it: ActivityInboxItem): boolean {
    return (
        !it.undone &&
        !it.undoFailed &&
        Date.now() < it.undoUntil &&
        it.kind === 'repair_status' &&
        it.repairId != null &&
        it.previousStatus !== undefined
    );
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
    const { items, pendingUndoId, undoItem, dismissItem, clear } = useActivityInbox();
    const [, setNowTick] = useState(0);

    useEffect(() => {
        const hasTimedUndo = items.some((i) => canShowUndo(i));
        if (!hasTimedUndo) return;
        const t = window.setInterval(() => setNowTick((n) => n + 1), 1000);
        return () => window.clearInterval(t);
    }, [items]);

    return (
        <div
            role="dialog"
            aria-label="Recent activity inbox"
            className="flex max-h-[calc(100vh-6rem)] w-[340px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
        >
            <header className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-4 py-2">
                <div>
                    <p className="text-micro font-black uppercase tracking-widest text-gray-500">
                        Recent activity
                    </p>
                    <p className="mt-0.5 text-sm font-black text-gray-900">
                        Reversible updates · undo within 60s
                    </p>
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
                        Reversible updates (like repair status) land here — use Undo
                        within one minute after a change.
                    </p>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {items.map((it) => (
                            <li key={it.id} className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        {it.kind === 'warranty_claim' && it.claimId ? (
                                            <Link
                                                href={`/dashboard?warranty=&open=${it.claimId}`}
                                                onClick={onClose}
                                                className="block truncate text-caption font-black text-blue-700 hover:text-blue-900 hover:underline"
                                            >
                                                {it.title}
                                            </Link>
                                        ) : (
                                            <p className="truncate text-caption font-black text-gray-900">
                                                {it.title}
                                            </p>
                                        )}
                                        <p className="mt-0.5 whitespace-pre-wrap break-words text-mini font-medium leading-snug text-gray-600">
                                            {it.subtitle}
                                        </p>
                                        <p className="mt-1 text-micro font-bold uppercase tracking-wide text-gray-400">
                                            {formatDistanceToNowStrict(new Date(it.createdAt), {
                                                addSuffix: true,
                                            })}
                                            {canShowUndo(it) && (
                                                <>
                                                    {' · '}
                                                    <span className="text-amber-600">
                                                        Undo{' '}
                                                        {Math.max(
                                                            0,
                                                            Math.ceil((it.undoUntil - Date.now()) / 1000),
                                                        )}
                                                        s
                                                    </span>
                                                </>
                                            )}
                                            {it.undone && !it.undoFailed && (
                                                <span className="text-emerald-600"> · Reverted</span>
                                            )}
                                            {it.undoFailed && (
                                                <span className="text-rose-600"> · Undo failed</span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        {canShowUndo(it) && (
                                            <button
                                                type="button"
                                                disabled={pendingUndoId === it.id}
                                                onClick={() => void undoItem(it.id)}
                                                className="rounded-md bg-gray-900 px-2 py-1 text-micro font-black uppercase tracking-wide text-white disabled:opacity-50"
                                            >
                                                {pendingUndoId === it.id ? '…' : 'Undo'}
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

            <footer className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2">
                <Link
                    href="/settings?section=operations-log"
                    onClick={onClose}
                    className="flex items-center gap-2 text-caption font-semibold text-blue-600 hover:text-blue-800"
                >
                    <ClipboardList className="h-3.5 w-3.5 shrink-0" />
                    Open operations log
                </Link>
            </footer>
        </div>
    );
}
