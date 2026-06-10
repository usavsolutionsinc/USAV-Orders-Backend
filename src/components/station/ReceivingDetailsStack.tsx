'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Edit, Loader2, Package, RefreshCw, Trash2, X } from '@/components/Icons';
import { copyToClipboard } from '@/utils/_dom';
import { formatDateTimePST } from '@/utils/date';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { TrackingNumberRow } from '@/components/ui/TrackingNumberRow';
import { listingUrlForOpen } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { toast } from '@/lib/toast';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import {
  CARRIER_OPTS,
  QA_OPTS,
  DISPOSITION_OPTS,
  CONDITION_OPTS,
} from '@/components/station/receiving-constants';
import { dispatchReceivingWorkspaceOpen } from '@/utils/events';
import { PoLinesSection } from './receiving/PoLinesSection';
import { ReceivingOverviewCard } from './receiving/ReceivingOverviewCard';
import { useReceivingDetailForm, normalizeCarrier } from '@/hooks/useReceivingDetailForm';
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

export interface ReceivingDetailsLog {
  id: string;
  timestamp: string;
  tracking?: string;
  status?: string;
  count?: number;
  qa_status?: string | null;
  disposition_code?: string | null;
  condition_grade?: string | null;
  is_return?: boolean;
  return_platform?: string | null;
  return_reason?: string | null;
  needs_test?: boolean;
  assigned_tech_id?: number | null;
  target_channel?: string | null;
  received_at?: string | null;
  received_by?: number | null;
  unboxed_at?: string | null;
  unboxed_by?: number | null;
  /** Earliest `receiving_scans` row for this carton (when present). */
  tracking_scanned_at?: string | null;
  tracking_scanned_by?: number | null;
  zoho_purchase_receive_id?: string | null;
  zoho_warehouse_id?: string | null;
  /** First-line Zoho PO linkage (merged in by receiving overlay fetch). */
  zoho_purchaseorder_id?: string | null;
  zoho_purchaseorder_number?: string | null;
  /** First-line listing URL when present. */
  listing_url?: string | null;
}

// CARRIER_OPTS, QA_OPTS, DISPOSITION_OPTS, CONDITION_OPTS now come from the
// shared receiving-constants source of truth (imported above). The previous
// local copies had drifted — QA was missing HOLD and CONDITION was missing
// LIKE_NEW + REFURBISHED.
const RETURN_PLATFORM_OPTS = [
  { value: '', label: 'Select Platform' },
  { value: 'AMZ', label: 'AMZ' },
  { value: 'EBAY_DRAGONH', label: 'eBay DragonH' },
  { value: 'EBAY_USAV', label: 'eBay USAV' },
  { value: 'EBAY_MEKONG', label: 'eBay Mekong' },
  { value: 'FBA', label: 'FBA' },
  { value: 'WALMART', label: 'Walmart' },
  { value: 'ECWID', label: 'Ecwid' },
];
const CHANNEL_OPTS = [
  { value: 'ORDERS', label: 'PO',     active: 'bg-emerald-500 text-white',  inactive: 'bg-gray-100 text-gray-500' },
  { value: 'RETURN', label: 'Return', active: 'bg-red-500 text-white',      inactive: 'bg-gray-100 text-gray-500' },
  { value: 'REPAIR', label: 'Repair', active: 'bg-orange-400 text-white',   inactive: 'bg-gray-100 text-gray-500' },
];

interface ReceivingDetailsStackProps {
  log: ReceivingDetailsLog;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

export function ReceivingDetailsStack({ log, onClose, onUpdated, onDeleted }: ReceivingDetailsStackProps) {
  const form = useReceivingDetailForm({ log, onClose, onUpdated, onDeleted });
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
      // Commit any in-flight detail-stack edits so the workspace opens with
      // the saved state — handleClose() would also save, but explicit save
      // here gives us a deterministic order: save → fetch → dispatch → close.
      await form.handleSave();
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
    if (form.isSaving) return;
    void form.handleClose();
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
      {/* Header — eyebrow + value identity, primary "Edit PO" action in the
          right slot, and segmented tabs in the dual-sticky belowSlot. Matches
          the 2026 ops convention (Vercel/Front/Stripe pattern). */}
      <PaneHeader
        className="shrink-0 border-gray-100 bg-white/90 backdrop-blur-xl"
        rowClassName="px-6"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Package} bg="bg-blue-600" tint="text-white" />
            <PaneHeaderLabel
              eyebrow={
                <>
                  RECEIVING <span className="text-gray-500"> · {formatDateTimePST(log.timestamp)}</span>
                </>
              }
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
              onClick={form.handleClose}
              disabled={form.isSaving}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 disabled:opacity-50"
              aria-label="Save and close"
            >
              {form.isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <X className="h-5 w-5" />}
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

          {/* Channel slider — `nav` variant lights the active pill blue to
              match the global sidebar nav, replacing the prior black/slate
              active state. */}
          <HorizontalButtonSlider
            aria-label="Target channel"
            variant="nav"
            value={form.targetChannel}
            onChange={(id) => form.setTargetChannel(id)}
            items={CHANNEL_OPTS.map<HorizontalSliderItem>((ch) => ({
              id: ch.value,
              label: ch.label,
            }))}
          />

          {/* Return details */}
          {form.isReturn && (
            <div className="space-y-2">
              <ViewDropdown options={RETURN_PLATFORM_OPTS} value={form.returnPlatform} onChange={form.setReturnPlatform} borderRadius="12px" backgroundColor="#ffffff" fontSize="11px" />
              <textarea
                value={form.returnReason}
                onChange={(e) => form.setReturnReason(e.target.value)}
                placeholder="Return reason"
                className="min-h-[60px] w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
          )}

          {/* Needs Test */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <label className="flex items-center gap-2 text-micro font-black uppercase tracking-widest text-gray-700">
              <input
                type="checkbox"
                checked={form.needsTest}
                onChange={(e) => form.setNeedsTest(e.target.checked)}
                disabled={form.targetChannel === 'REPAIR'}
              />
              Needs Test
            </label>
            {form.needsTest && form.techs.length > 0 && (
              <div
                ref={form.channelScrollRef}
                onWheel={form.handleChannelWheel}
                className="overflow-x-auto w-full"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #f9fafb' }}
              >
                <div className="flex gap-1.5 w-max pb-1">
                  {form.techs.map((tech) => {
                    const theme = getStaffThemeById(tech.id);
                    const colors = stationThemeColors[theme];
                    const isActive = form.assignedTechId === String(tech.id);
                    return (
                      <button
                        key={tech.id}
                        type="button"
                        onClick={() => form.setAssignedTechId(String(tech.id))}
                        className={`rounded-xl px-4 py-2 text-caption font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                          isActive ? `${colors.bg} text-white` : `bg-gray-100 ${colors.text} hover:${colors.light}`
                        }`}
                      >
                        {tech.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Condition + Carrier */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Condition</label>
              <ViewDropdown options={CONDITION_OPTS} value={form.conditionGrade} onChange={form.setConditionGrade} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Carrier</label>
              <ViewDropdown
                options={CARRIER_OPTS.some((o) => o.value === form.carrier) ? CARRIER_OPTS : [{ value: form.carrier, label: form.carrier }, ...CARRIER_OPTS]}
                value={form.carrier}
                onChange={(v) => form.setCarrier(normalizeCarrier(v))}
                borderRadius="12px"
                backgroundColor="#f9fafb"
                fontSize="11px"
              />
            </div>
          </div>

          {/* Disposition + QA Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Disposition</label>
              <ViewDropdown options={DISPOSITION_OPTS} value={form.dispositionCode} onChange={form.setDispositionCode} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-eyebrow font-black uppercase tracking-widest text-gray-500">QA Status</label>
              <ViewDropdown options={QA_OPTS} value={form.qaStatus} onChange={form.setQaStatus} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
          </div>
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
              ? 'Click again to confirm delete'
              : 'Delete receiving'}
        </button>
      </div>
    </motion.div>
    </>
  );
}
