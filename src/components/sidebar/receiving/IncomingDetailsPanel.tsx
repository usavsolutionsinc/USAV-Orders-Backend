'use client';

import { motion } from 'framer-motion';
import { X, RefreshCw, Trash2 } from '@/components/Icons';
import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import DeleteButton from '@/components/ui/DeleteButton';
import { PoChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button, IconButton } from '@/design-system/primitives';
import { TABS, type TabId, type IncomingDetailsPanelProps } from './incoming-details/incoming-details-shared';
import { useIncomingDetails } from './incoming-details/useIncomingDetails';
import { PoTab } from './incoming-details/PoTab';
import { ShipmentTab } from './incoming-details/ShipmentTab';
import { ActivityTab } from './incoming-details/ActivityTab';
import { EmailTab } from './incoming-details/EmailTab';
import { NotesTab } from './incoming-details/NotesTab';

export type { IncomingDetailsPanelProps } from './incoming-details/incoming-details-shared';

/**
 * Tabbed details panel for a single incoming PO. Mounts over the table in
 * `mode=incoming` when a row is clicked. Data comes from one consolidated
 * endpoint (`/api/receiving-lines/incoming/details`) — single round-trip,
 * react-query cache key by PO id so tab switches don't re-fetch.
 *
 * Thin composition shell: data + actions live in {@link useIncomingDetails};
 * the five tab bodies are presentational components under `./incoming-details/`.
 */
export function IncomingDetailsPanel(props: IncomingDetailsPanelProps) {
  const { onClose } = props;
  const c = useIncomingDetails(props);
  const { isShipmentOnly, tab, setTab, syncing, syncOne, handleDelete, data, isLoading, isError, headerPo, headerTracking } = c;

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-panel flex h-screen w-[420px] flex-col overflow-hidden border-l border-border-soft bg-surface-card shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
      {/* Header — PO chip (last-4 copy) + vendor + close. */}
      <div className="shrink-0 border-b border-border-soft bg-surface-card px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {headerPo ? (
              <PoChip value={headerPo} display={getLast4(headerPo)} />
            ) : headerTracking ? (
              <TrackingChip value={headerTracking} display={getLast4(headerTracking)} />
            ) : (
              <span className="font-mono text-sm font-bold text-text-faint">—</span>
            )}
            {data?.po?.vendor_name ? (
              <span className="truncate text-caption font-semibold text-text-soft">
                · {data.po.vendor_name}
              </span>
            ) : null}
          </div>
          {/* Sync re-pulls the PO header from Zoho — only meaningful when there
              IS a PO. A shipment-only box uses the Shipment tab's "Re-poll"
              (carrier) instead. */}
          {isShipmentOnly ? null : (
            <HoverTooltip label="Re-pull this PO from Zoho + re-poll its shipment" asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void syncOne()}
                disabled={syncing}
                ariaLabel="Sync this PO"
                icon={<RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />}
                className="h-7 gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-eyebrow font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100"
              >
                {syncing ? 'Syncing' : 'Sync'}
              </Button>
            </HoverTooltip>
          )}
          <IconButton
            onClick={onClose}
            ariaLabel="Close details panel"
            icon={<X className="h-4 w-4" />}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-soft hover:bg-surface-sunken hover:text-text-default"
          />
        </div>

      </div>

      {/* Tab nav — reuses PaneHeaderTabs (active tab = bg-gray-900 + white
          text) so this panel matches the shipped + work-order detail panes. */}
      <div className="shrink-0 border-b border-border-soft">
        <PaneHeaderTabs<TabId>
          tabs={TABS}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-caption font-semibold text-text-faint">
            Loading details…
          </div>
        ) : isError || !data?.success ? (
          <div className="flex h-full items-center justify-center text-caption font-semibold text-rose-600">
            Could not load PO details.
          </div>
        ) : (
          <div className="p-4">
            {tab === 'po' && <PoTab data={data} />}
            {tab === 'shipment' && <ShipmentTab data={data} />}
            {tab === 'activity' && <ActivityTab data={data} />}
            {tab === 'email' && <EmailTab data={data} />}
            {tab === 'notes' && (
              <NotesTab
                receivingId={data.receiving?.id ?? null}
                initialValue={data.notes ?? ''}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer — destructive action. Reuses the shared DeleteButton styled to
          match the shipped panel's DeleteOrderControl (solid red, Trash2,
          two-step confirm). Removes every receiving_line for this PO (the
          Incoming row); Zoho is untouched. */}
      <div className="shrink-0 border-t border-border-soft bg-surface-card px-4 py-2.5">
        <DeleteButton
          onConfirm={handleDelete}
          onDeleted={onClose}
          icon={<Trash2 className="w-3.5 h-3.5" />}
          label="Delete"
          armedLabel="Click Again To Confirm"
          className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-micro font-black uppercase tracking-wider disabled:opacity-50"
        />
      </div>
      </motion.div>
    </>
  );
}
