'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { Bell, ClipboardList } from '@/components/Icons';
import {
  useActivityInbox,
  type ActivityInboxItem,
} from '@/contexts/ActivityInboxContext';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/_cn';

interface ActivityInboxButtonProps {
  /** Popover grows toward the viewport center from the bell. */
  popoverPlacement?: 'up' | 'down';
  className?: string;
  buttonClassName?: string;
  /**
   * Operations dashboard hides the docked inbox; header passes `true` so the
   * bell still renders on `/operations`.
   */
  routesAllowOperations?: boolean;
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

export function ActivityInboxButton({
  popoverPlacement = 'down',
  className,
  buttonClassName,
  routesAllowOperations = false,
}: ActivityInboxButtonProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const {
    items,
    pendingUndoId,
    undoItem,
    dismissItem,
    clear,
  } = useActivityInbox();

  const [open, setOpen] = useState(false);
  const [, setNowTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hasTimedUndo = items.some((i) => canShowUndo(i));
    if (!hasTimedUndo) return;
    const t = window.setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [items]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const onBellClick = useCallback(() => setOpen((o) => !o), []);

  if (!user) return null;
  const isAuthRoute =
    pathname === '/signin' || pathname?.startsWith('/signin/');
  if (isAuthRoute) return null;

  const isOpsRoute =
    pathname === '/operations' ||
    (pathname?.startsWith('/operations/') ?? false);
  if (!routesAllowOperations && isOpsRoute) return null;

  const activeCount = items.filter((i) => !i.undone || i.undoFailed).length;

  const popoverPos =
    popoverPlacement === 'up'
      ? 'bottom-full mb-2 right-0'
      : 'top-full mt-2 right-0';

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={onBellClick}
        aria-label="Recent activity inbox"
        aria-expanded={open}
        className={cn(
          'relative rounded-md p-1.5 text-gray-600 transition-colors hover:bg-gray-100',
          buttonClassName,
        )}
      >
        <Bell className="h-4 w-4 shrink-0" />
        {activeCount > 0 && (
          <span className="absolute right-1 top-1 h-1.5 min-w-[0.375rem] rounded-full border border-white bg-rose-500 px-0.5 text-[8px] font-black leading-none text-white" />
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 w-[min(100vw-2rem,22rem)] rounded-xl border border-gray-200 bg-white shadow-xl ring-1 ring-black/5',
            popoverPos,
          )}
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-mini font-black uppercase tracking-wider text-gray-700">
              Recent activity
            </span>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => clear()}
                className="text-mini font-bold uppercase tracking-wide text-gray-500 hover:text-gray-800"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-caption text-gray-500">
                Reversible updates (like repair status) land here — use Undo
                within one minute after a change.
              </p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {items.map((it) => (
                  <li key={it.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-caption font-black text-gray-900">
                          {it.title}
                        </p>
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
                            <span className="text-emerald-600">
                              {' '}
                              · Reverted
                            </span>
                          )}
                          {it.undoFailed && (
                            <span className="text-rose-600">
                              {' '}
                              · Undo failed
                            </span>
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

          <div className="border-t border-gray-100 px-3 py-2">
            <Link
              href="/settings?section=operations-log"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 text-mini font-bold text-blue-600 hover:text-blue-800"
            >
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              Open operations log
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Legacy fixed bottom-left inbox dock. Replaced by stacking
 * `ActivityInboxButton` inside `QuickAccessFab` at the bottom-right. Kept
 * exported for routes that explicitly want the bottom-left placement.
 */
export function ActivityInboxDock() {
  return (
    <div
      className={cn(
        'pointer-events-auto fixed z-40',
        'bottom-20 left-4 sm:bottom-6 sm:left-6',
      )}
    >
      <ActivityInboxButton
        popoverPlacement="up"
        buttonClassName={cn(
          'h-11 w-11 rounded-full bg-white shadow-lg ring-2 ring-gray-200',
          'hover:bg-gray-50',
        )}
      />
    </div>
  );
}
