'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Database, RefreshCw, X, Loader2, Check } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
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
          {/* ds-raw-button: single child of a Radix Popover.Trigger asChild — the Slot clones onto this element; a DS Button would disturb the single-child clone + title. */}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-white shadow-lg shadow-blue-600/10 transition-all hover:bg-blue-700 active:scale-95"
            // ds-allow-title: single child of a Radix Popover.Trigger asChild — wrapping in HoverTooltip would disturb the Slot's single-child clone.
            title="Sync & backfill orders"
          >
            {sync.isTransferring ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {/* Explicit white — the button is a fixed blue fill in every theme. */}
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
            className="z-dropdown rounded-2xl border border-border-soft bg-surface-card p-3 shadow-xl ring-1 ring-black/5 focus:outline-none"
          >
            <div className="mb-3 flex items-center gap-1 rounded-xl bg-surface-sunken p-1">
              {(['sync', 'backfill'] as SyncTab[]).map((t) => (
                // ds-raw-button: segmented tab toggle (conditional active fill), not a single-variant Button
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-eyebrow font-black uppercase tracking-wider transition-colors ${
                    tab === t ? 'bg-surface-card text-text-accent shadow-sm' : 'text-text-soft hover:text-text-muted'
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
                      className="w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 font-mono text-caption text-text-default outline-none transition-all focus:border-border-accent"
                      disabled={sync.isTransferring}
                    />
                    {sync.isTransferring ? (
                      <Button
                        variant="danger"
                        size="lg"
                        onClick={sync.handleCancelTransfer}
                        icon={<X className="h-3.5 w-3.5" />}
                        className="w-full text-micro font-black uppercase tracking-[0.2em]"
                      >
                        Cancel Import
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={sync.handleTransfer}
                        icon={<Database className="h-3.5 w-3.5" />}
                        className="w-full text-micro font-black uppercase tracking-[0.2em]"
                      >
                        Import Latest Orders
                      </Button>
                    )}

                    {sync.isTransferring || sync.sheetsTask.status !== 'idle' || sync.ecwidTask.status !== 'idle' ? (
                      // ds-raw-button: composite text-left status row (icon + label + "View details" + elapsed time), justify-between — not a standard action button
                      <button
                        type="button"
                        onClick={() => sync.setIsSyncDialogOpen(true)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-accent bg-surface-accent/60 px-3 py-2.5 text-left transition hover:bg-surface-accent/80"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {sync.isTransferring ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-text-accent" />
                          )}
                          <span className={`${sectionLabel} text-text-accent`}>
                            {sync.isTransferring ? 'Importing…' : 'Import complete'}
                          </span>
                          <span className="text-eyebrow text-text-accent">View details</span>
                        </div>
                        <span className="text-caption font-mono font-bold tabular-nums text-text-accent">
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
                  <p className="px-1 py-6 text-center text-caption text-text-faint">
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
