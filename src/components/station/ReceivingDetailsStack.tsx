'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Edit, Loader2, Package, RefreshCw, Trash2, X } from '@/components/Icons';
import { copyToClipboard } from '@/utils/_dom';
import { formatDateTimePST } from '@/utils/date';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { TrackingNumberRow } from '@/components/ui/TrackingNumberRow';
import { listingUrlForOpen } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { toast } from '@/lib/toast';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { type ReceivingDetailsLog } from './receiving-details-log';
import { dispatchReceivingWorkspaceOpen } from '@/utils/events';
import { PoLinesSection } from './receiving/PoLinesSection';
import { ReceivingOverviewCard } from './receiving/ReceivingOverviewCard';
import { useReceivingDetailForm } from '@/hooks/useReceivingDetailForm';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';

type ReceivingTab = 'overview' | 'lines' | 'details';

// `ReceivingDetailsLog` lives in a leaf module (`./receiving-details-log`) so it
// can be referenced without importing this component (which imports utils/events,
// forming a cycle). Re-exported here for backwards compatibility.
export type { ReceivingDetailsLog } from './receiving-details-log';

interface ReceivingDetailsStackProps {
  log: ReceivingDetailsLog;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

export function ReceivingDetailsStack({ log, onClose, onUpdated, onDeleted }: ReceivingDetailsStackProps) {
  const form = useReceivingDetailForm({ log, onUpdated, onDeleted });
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpeningEditor, setIsOpeningEditor] = useState(false);
  const [activeTab, setActiveTab] = useState<ReceivingTab>('overview');
  const [isCopying, setIsCopying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleRefresh = () => {
    onUpdated();
    toast.success('Refreshed');
  };

  const handleClose = () => {
    if (form.isSaving || form.isDeleting) return;
    onClose();
  };

  const handleCopyAll = async () => {
    if (isCopying) return;
    setIsCopying(true);
    try {
      const lines = [
        `Receiving #${log.id}`,
        log.tracking ? `Tracking: ${log.tracking}` : null,
        `Received: ${log.received_at ? formatDateTimePST(log.received_at) : '-'}`,
        log.zoho_purchase_receive_id ? `Zoho Receive: ${log.zoho_purchase_receive_id}` : null,
        log.qa_status ? `QA: ${log.qa_status}` : null,
        log.disposition_code ? `Disposition: ${log.disposition_code}` : null,
        log.condition_grade ? `Condition: ${log.condition_grade}` : null,
      ].filter(Boolean).join('\n');
      const ok = await copyToClipboard(lines);
      if (ok) toast.success('Copied receiving details');
      else toast.error('Could not copy to clipboard');
    } finally {
      window.setTimeout(() => setIsCopying(false), 800);
    }
  };

  const handleEditPO = async () => {
    if (isOpeningEditor || form.isSaving) return;
    setIsOpeningEditor(true);
    try {
      const saved = await form.saveTrackingIfDirty();
      if (!saved) return;
      const receivingId = Number(log.id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) {
        toast.error('Receiving id missing');
        return;
      }
      const res = await fetch(`/api/receiving-lines?receiving_id=${receivingId}&include=serials`);
      const data = await res.json().catch(() => null);
      const rows = Array.isArray(data?.receiving_lines)
        ? (data.receiving_lines as ReceivingLineRow[])
        : [];
      if (rows.length === 0) {
        toast.error('No lines on this receiving yet');
        return;
      }
      // Flip URL to `?mode=receive` so the receiving page renders the
      // workspace surface (the dashboard hides the workspace when mode
      // is `history`).
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'receive');
      router.replace(`/receiving?${params.toString()}`);
      onClose();
      // Dispatch workspace-open DIRECTLY (bypassing the sidebar's
      // receiving-select-line intercept that would otherwise re-route
      // back into a details stack while the URL flip is still in flight).
      // The dashboard listens for `receiving-workspace-open` and mounts
      // the LineEditPanel overlay independently of sidebar state.
      dispatchReceivingWorkspaceOpen({
        row: rows[0],
        accordionBootstrap: 'all',
        scanDriven: false,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open PO editor');
    } finally {
      setIsOpeningEditor(false);
    }
  };

  const backdropClose = () => {
    handleClose();
  };

  return (
    <>
      <SlideOverBackdrop onClose={backdropClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
        className="fixed right-0 top-0 z-panel flex h-screen w-[420px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
      >
      {/* Header — receiving ID identity, primary "Edit PO" action in the
          right slot, and segmented tabs in the dual-sticky belowSlot. Matches
          the 2026 ops convention (Vercel/Front/Stripe pattern). */}
      <PaneHeader
        className="shrink-0 border-gray-100 bg-white/90 backdrop-blur-xl"
        rowClassName="px-6"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Package} bg="bg-blue-600" tint="text-white" />
            <PaneHeaderLabel
              value={`#${log.id}`}
              valueTitle={`Receiving #${log.id}`}
            />
          </>
        }
        rightSlot={
          <>
            <button
              type="button"
              onClick={handleEditPO}
              disabled={isOpeningEditor || form.isSaving}
              className="group inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-caption font-black uppercase tracking-wider text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isOpeningEditor ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Edit className="h-3.5 w-3.5" />
              )}
              <span>{isOpeningEditor ? 'Opening…' : 'Edit PO'}</span>
              <span aria-hidden className="text-white/70 transition-transform group-hover:translate-x-0.5">→</span>
            </button>
            <button
              onClick={handleClose}
              disabled={form.isSaving || form.isDeleting}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </>
        }
        belowSlot={
          <>
            {/* Utility toolbar — same shape as the LineEditPanel toolbar, so
                detail panes have one consistent action surface. Sits ABOVE
                the tabs per the dual-sticky preview. */}
            <div className="px-6 pb-2">
              <PaneHeaderActionBar
                iconOnly
                actions={[
                  {
                    key: 'refresh',
                    label: 'Refresh',
                    icon: <RefreshCw className="h-3.5 w-3.5" />,
                    onClick: handleRefresh,
                    disabled: form.isSaving,
                    title: 'Refetch this receiving log',
                  },
                  {
                    key: 'copy',
                    label: 'Copy',
                    icon: <Copy className={`h-3.5 w-3.5 ${isCopying ? 'animate-pulse' : ''}`} />,
                    onClick: () => void handleCopyAll(),
                    disabled: isCopying,
                    title: 'Copy receiving details to clipboard',
                  },
                ] satisfies PaneHeaderActionBarAction[]}
                status={form.isSaving ? 'Saving' : undefined}
                onPrev={() =>
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-detail-overlay', {
                      detail: { direction: 'prev', currentReceivingId: Number(log.id) },
                    }),
                  )
                }
                onNext={() =>
                  window.dispatchEvent(
                    new CustomEvent('receiving-navigate-detail-overlay', {
                      detail: { direction: 'next', currentReceivingId: Number(log.id) },
                    }),
                  )
                }
                prevTitle="Previous receiving"
                nextTitle="Next receiving"
              />
            </div>
            <PaneHeaderTabs<ReceivingTab>
              tabs={[
                { value: 'overview', label: 'Overview' },
                { value: 'lines', label: 'Items', count: typeof log.count === 'number' ? log.count : undefined },
                { value: 'details', label: 'Details' },
              ]}
              value={activeTab}
              onChange={setActiveTab}
              className="px-6"
            />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-4">
          {activeTab === 'overview' && (
            <ReceivingOverviewCard log={log} />
          )}

          {activeTab === 'lines' && (
            <PoLinesSection receivingId={log.id} trackingNumber={log.tracking} />
          )}

          {activeTab === 'details' && (
            <>
          {/* Identifiers — labeled ledger rows (shipped / unfound pattern) so
              last-4 chips cannot collide (e.g. tracking suffix vs warehouse id). */}
          {(() => {
            const listingRaw = String(log.listing_url || '').trim();
            const poValue = String(
              log.zoho_purchaseorder_number || log.zoho_purchaseorder_id || '',
            ).trim();
            const receiveId = String(log.zoho_purchase_receive_id || '').trim();
            const warehouseId = String(log.zoho_warehouse_id || '').trim();
            return (
              <div className="space-y-0">
                <TrackingNumberRow
                  label="Tracking"
                  value={form.tracking}
                  placeholder="Tracking number"
                  allowEdit
                  onChange={form.setTracking}
                  onBlur={() => void form.saveTrackingIfDirty()}
                  keepBottomDivider={Boolean(listingRaw || poValue || receiveId || warehouseId)}
                />
                {listingRaw ? (
                  <CopyableValueFieldBlock
                    label="Listing"
                    value={listingRaw}
                    externalUrl={listingUrlForOpen(listingRaw)}
                    externalLabel="Open listing"
                    variant="flat"
                    twoLineValue
                    noTruncate
                    keepBottomDivider
                  />
                ) : null}
                {poValue ? (
                  <CopyableValueFieldBlock
                    label="PO number"
                    value={poValue}
                    variant="flat"
                    keepBottomDivider
                  />
                ) : null}
                {receiveId ? (
                  <CopyableValueFieldBlock
                    label="Zoho receive"
                    value={receiveId}
                    variant="flat"
                    keepBottomDivider
                  />
                ) : null}
                {warehouseId ? (
                  <CopyableValueFieldBlock
                    label="Warehouse"
                    value={warehouseId}
                    variant="flat"
                  />
                ) : null}
              </div>
            );
          })()}
            </>
          )}

        </div>
      </div>

      {/* Footer — destructive action pinned to panel bottom (unfound / shipped pattern). */}
      <div className="shrink-0 border-t border-gray-100 px-6 py-3">
        {form.saveState === 'error' && (
          <p className="mb-2 text-center text-micro font-black uppercase tracking-wider text-red-500">
            Save failed — check connection
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              window.setTimeout(() => setConfirmingDelete(false), 3000);
              return;
            }
            setConfirmingDelete(false);
            void form.handleDelete();
          }}
          disabled={form.isDeleting || form.isSaving}
          className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-micro font-black uppercase tracking-wider text-white transition-colors disabled:opacity-50 ${
            confirmingDelete ? 'bg-red-700 hover:bg-red-800' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {form.isDeleting
            ? 'Deleting...'
            : confirmingDelete
              ? 'Click again to confirm'
              : 'Delete'}
        </button>
      </div>
    </motion.div>
    </>
  );
}
