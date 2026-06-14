'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Database, RefreshCw, X, Loader2, Check } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useAuth } from '@/contexts/AuthContext';
import { useOrdersSync } from '@/hooks/useOrdersSync';
import { OrderSyncDialog } from '@/components/sidebar/OrderSyncDialog';
import { AwaitingEbayPanel } from '@/components/unshipped/AwaitingEbayPanel';

type SyncTab = 'sync' | 'backfill';

/**
 * One **Sync** button → a tabbed popover that unifies the two order-sync
 * surfaces the merged Unshipped sidebar needs:
 *   - **Sync** — Google Sheets + Ecwid Direct transfer + Resolved Exceptions
 *     (the "Import Latest Orders" flow), via {@link useOrdersSync}; detailed
 *     per-tab progress shows in the centered {@link OrderSyncDialog}.
 *   - **Backfill** — eBay/Ecwid order backfill + integrity check
 *     ({@link AwaitingEbayPanel}).
 * Replaces the old split (main Sync lived in DashboardManagementPanel, Backfill
 * in a standalone AwaitingEbayPanel).
 */
export function OrdersSyncPopover({ onRefresh }: { onRefresh?: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SyncTab>('sync');
  const { has } = useAuth();
  const canImportOrders = has('orders.import');
  const sync = useOrdersSync();

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-white shadow-lg shadow-blue-600/10 transition-all hover:bg-blue-700 active:scale-95"
            title="Sync & backfill orders"
          >
            {sync.isTransferring ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {/* Explicit white (sectionLabel's own text-gray-500 is invisible on blue). */}
            <span className="text-micro font-black uppercase tracking-[0.2em] text-white">
              {sync.isTransferring ? 'Syncing…' : 'Sync Orders'}
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            // Match the trigger (= the master-nav/sidebar content width) exactly
            // via Radix's trigger-width var, so the popover never over/under-hangs.
            style={{ width: 'var(--radix-popover-trigger-width)' }}
            className="z-dropdown rounded-2xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5 focus:outline-none"
          >
            <div className="mb-3 flex items-center gap-1 rounded-xl bg-gray-100 p-1">
              {(['sync', 'backfill'] as SyncTab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-eyebrow font-black uppercase tracking-wider transition-colors ${
                    tab === t ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t === 'sync' ? 'Sync' : 'Backfill'}
                </button>
              ))}
            </div>

            {tab === 'sync' ? (
              <div className="space-y-3">
                {canImportOrders ? (
                  <>
                    <input
                      type="text"
                      value={sync.manualSheetName}
                      onChange={(e) => sync.setManualSheetName(e.target.value)}
                      placeholder="e.g., Sheet_01_14_2026"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-caption text-gray-900 outline-none transition-all focus:border-blue-500"
                      disabled={sync.isTransferring}
                    />
                    {sync.isTransferring ? (
                      <button
                        type="button"
                        onClick={sync.handleCancelTransfer}
                        className={`flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-white transition-all hover:bg-red-600 active:scale-95 ${sectionLabel}`}
                      >
                        <X className="h-3.5 w-3.5" /> Cancel Import
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={sync.handleTransfer}
                        className={`flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-white transition-all hover:bg-blue-700 active:scale-95 ${sectionLabel}`}
                      >
                        <Database className="h-3.5 w-3.5" /> Import Latest Orders
                      </button>
                    )}

                    {sync.isTransferring || sync.sheetsTask.status !== 'idle' || sync.ecwidTask.status !== 'idle' ? (
                      <button
                        type="button"
                        onClick={() => sync.setIsSyncDialogOpen(true)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-left transition hover:bg-blue-100/60"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {sync.isTransferring ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-blue-600" />
                          )}
                          <span className={`${sectionLabel} text-blue-700`}>
                            {sync.isTransferring ? 'Importing…' : 'Import complete'}
                          </span>
                          <span className="text-eyebrow text-blue-400">View details</span>
                        </div>
                        <span className="text-caption font-mono font-bold tabular-nums text-blue-500">
                          {(sync.elapsedMs / 1000).toFixed(1)}s
                        </span>
                      </button>
                    ) : null}

                    {sync.status ? (
                      <div
                        className={`rounded-xl border px-3 py-2 ${
                          sync.status.type === 'success'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                        }`}
                      >
                        <p className="text-eyebrow font-bold leading-relaxed">{sync.status.message}</p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="px-1 py-6 text-center text-caption text-gray-400">
                    You don&apos;t have permission to import orders.
                  </p>
                )}
              </div>
            ) : (
              <AwaitingEbayPanel onRefresh={onRefresh} />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <OrderSyncDialog
        open={sync.isSyncDialogOpen}
        onClose={() => sync.setIsSyncDialogOpen(false)}
        isRunning={sync.isTransferring}
        elapsedMs={sync.elapsedMs}
        onCancel={sync.handleCancelTransfer}
        sheets={sync.sheetsTask}
        ecwid={sync.ecwidTask}
        exceptions={sync.exceptionsTask}
      />
    </>
  );
}
