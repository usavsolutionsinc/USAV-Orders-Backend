'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UNBOX_SURFACE_ROUTE } from '@/lib/receiving/surface-path';
import { Copy, Edit, Package, RefreshCw, Trash2, X } from '@/components/Icons';
import { Button } from '@/design-system/primitives/Button';
import { IconButton } from '@/design-system/primitives/IconButton';
import { copyToClipboard } from '@/utils/_dom';
import { formatDateTimePST } from '@/utils/date';
import { toast } from '@/lib/toast';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { type ReceivingDetailsLog } from './receiving-details-log';
import { dispatchReceivingWorkspaceOpen } from '@/utils/events';
import { ReceivingProgressTab } from './receiving/ReceivingProgressTab';
import { ReceivingItemsTab } from './receiving/ReceivingItemsTab';
import { useReceivingDetailForm } from '@/hooks/useReceivingDetailForm';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderTabs,
  PaneHeaderActionBar,
  type PaneHeaderActionBarAction,
} from '@/components/ui/pane-header';
import { DetailStackRailRegistrar } from '@/components/right-rail/DetailStackRailRegistrar';
import { useQuery } from '@tanstack/react-query';
import {
  deriveCartonReadiness,
  type ReceivingMatchLine,
} from '@/lib/receiving/carton-readiness';

type ReceivingTab = 'progress' | 'items';

async function fetchReceivingMatchLines(receivingId: string): Promise<ReceivingMatchLine[]> {
  const res = await fetch(`/api/receiving/match?receiving_id=${encodeURIComponent(receivingId)}`);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const lines = Array.isArray(json?.matched_lines) ? (json.matched_lines as ReceivingMatchLine[]) : [];
  return lines;
}

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
  const [activeTab, setActiveTab] = useState<ReceivingTab>('progress');
  const [isCopying, setIsCopying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const matchQuery = useQuery({
    queryKey: ['receiving-match', String(log.id)] as const,
    queryFn: () => fetchReceivingMatchLines(String(log.id)),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const readiness = useMemo(
    () => deriveCartonReadiness(log, matchQuery.data),
    [log, matchQuery.data],
  );

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
      // Navigate to the Unbox surface (`/unbox`) so the page renders the
      // workspace. Drop any stale `mode` param — being on `/unbox` IS the
      // receive/unbox mode.
      const params = new URLSearchParams(searchParams.toString());
      params.delete('mode');
      const qs = params.toString();
      router.replace(qs ? `${UNBOX_SURFACE_ROUTE}?${qs}` : UNBOX_SURFACE_ROUTE);
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

  const handleSearchZohoPo = async () => {
    if (isOpeningEditor || form.isSaving) return;
    setIsOpeningEditor(true);
    try {
      const receivingId = Number(log.id);
      if (!Number.isFinite(receivingId) || receivingId <= 0) {
        toast.error('Receiving id missing');
        return;
      }
      const res = await fetch('/api/receiving/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiving_id: receivingId }),
      });
      if (!res.ok) {
        toast.error('Search failed — try again');
        return;
      }
      await matchQuery.refetch();
      toast.success('Linked PO lines');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed — try again');
    } finally {
      setIsOpeningEditor(false);
    }
  };

  const primaryCta = readiness.cta === 'continue_unbox'
    ? { label: 'Continue unbox', onClick: handleEditPO }
    : readiness.cta === 'match_po'
      ? { label: 'Search Zoho PO', onClick: handleSearchZohoPo }
      : { label: 'Edit PO', onClick: handleEditPO };

  const backdropClose = () => {
    handleClose();
  };

  return (
    <DetailStackRailRegistrar id={`detail:receiving:${log.id}`} onClose={backdropClose}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header — receiving ID identity, primary "Edit PO" action in the
          right slot, and segmented tabs in the dual-sticky belowSlot. Matches
          the 2026 ops convention (Vercel/Front/Stripe pattern). */}
      <PaneHeader
        className="shrink-0 border-border-hairline bg-surface-card/90 backdrop-blur-xl"
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
            <Button
              type="button"
              variant="primary"
              onClick={primaryCta.onClick}
              disabled={isOpeningEditor || form.isSaving}
              loading={isOpeningEditor}
              icon={<Edit />}
              iconRight={<span aria-hidden className="text-white/70">→</span>}
              className="text-caption font-black uppercase tracking-wider"
            >
              {isOpeningEditor ? 'Working…' : primaryCta.label}
            </Button>
            <IconButton
              onClick={handleClose}
              disabled={form.isSaving || form.isDeleting}
              ariaLabel="Close"
              icon={<X className="h-5 w-5" />}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-surface-sunken"
            />
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
                { value: 'progress', label: 'Progress' },
                { value: 'items', label: 'Items', count: typeof log.count === 'number' ? log.count : undefined },
              ]}
              value={activeTab}
              onChange={setActiveTab}
              className="px-6"
            />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        <div className="space-y-4">
          {activeTab === 'progress' && (
            <ReceivingProgressTab log={log} readiness={readiness} form={form} />
          )}

          {activeTab === 'items' && (
            <ReceivingItemsTab
              receivingId={log.id}
              trackingNumber={log.tracking}
              lineCount={readiness.lineCount}
            />
          )}

        </div>
      </div>

      {/* Footer — destructive action pinned to panel bottom (unfound / shipped pattern). */}
      <div className="shrink-0 border-t border-border-hairline px-6 py-3">
        {form.saveState === 'error' && (
          <p className="mb-2 text-center text-micro font-black uppercase tracking-wider text-red-500">
            Save failed — check connection
          </p>
        )}
        <Button
          type="button"
          variant="danger"
          size="lg"
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
          icon={<Trash2 />}
          className={`w-full text-micro font-black uppercase tracking-wider ${
            confirmingDelete ? 'bg-rose-700 hover:bg-rose-800' : ''
          }`}
        >
          {form.isDeleting
            ? 'Deleting...'
            : confirmingDelete
              ? 'Click again to confirm'
              : 'Delete'}
        </Button>
      </div>
      </div>
    </DetailStackRailRegistrar>
  );
}
