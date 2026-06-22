'use client';

/**
 * The `/receiving` right-pane column. The History/Incoming table stays mounted
 * (display-toggled) so its cache + scroll survive tab flips; over it the focused
 * line workspace crossfades in, a scan-in-flight skeleton covers the lookup gap,
 * a per-mode empty state shows when nothing is open, and the Incoming details
 * slide-over opens on a row select. Pure presentational; state + handlers come
 * from the dashboard's hooks. Extracted from ReceivingDashboard; behaviour is
 * unchanged.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import ReceivingLinesTable from '@/components/station/ReceivingLinesTable';
import { RECEIVING_SELECTION_SCOPE } from '@/components/station/ReceivingLinesTable';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { RightPaneOverlayHost } from '@/components/ui/RightPaneOverlay';
import { EmptyState } from '@/design-system/primitives';
import { Barcode } from '@/components/Icons';
import { ReceivingLineWorkspace } from '@/components/receiving/workspace/ReceivingLineWorkspace';
import { ReceivingScanLoader } from '@/components/receiving/workspace/ReceivingScanLoader';
import { IncomingDetailsPanel } from '@/components/sidebar/receiving/IncomingDetailsPanel';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type {
  NavState,
  WorkspaceState,
} from '@/components/receiving/useReceivingWorkspacePane';
import type { IncomingDetailsTarget } from '@/components/receiving/useReceivingDetailOverlays';

/**
 * Right-pane empty state per sidebar mode. Keyed by `?mode=` so each mode's copy
 * is structurally tied to that mode (triage's "pick from the Unfound/Prioritize
 * list" prompt is meaningless in Unbox, and vice versa). Modes without an entry
 * (history / incoming are table-only; pickup early-returns) render none.
 */
const RECEIVING_EMPTY_STATE: Partial<Record<string, { title: string; description: string }>> = {
  triage: {
    title: 'No carton selected',
    description:
      'Pick a carton from the Unfound or Prioritize list, or scan a tracking number to triage it.',
  },
  receive: {
    title: 'Scan to start',
    description: 'Scan a tracking number or pick a carton from the rail to open its PO here.',
  },
};

interface ReceivingRightPaneProps {
  mode: string;
  isTableOnlyMode: boolean;
  isTriageMode: boolean;
  isIncomingMode: boolean;
  selectMode: boolean;
  selectedRows: ReceivingLineRow[];
  bulkActions: SelectionAction<ReceivingLineRow>[];
  workspace: WorkspaceState | null;
  nav: NavState | null;
  scanInFlight: { tracking: string; startedAt: number } | null;
  staffId: string;
  prefersReducedMotion: boolean | null;
  incomingDetails: IncomingDetailsTarget | null;
  onCloseIncoming: () => void;
  onCloseWorkspace: () => void;
}

export function ReceivingRightPane({
  mode,
  isTableOnlyMode,
  isTriageMode,
  isIncomingMode,
  selectMode,
  selectedRows,
  bulkActions,
  workspace,
  nav,
  scanInFlight,
  staffId,
  prefersReducedMotion,
  incomingDetails,
  onCloseIncoming,
  onCloseWorkspace,
}: ReceivingRightPaneProps) {
  const showWorkspace = !!workspace && !isTableOnlyMode;
  // Scan loader covers the gap between scan and PO/line mounting. It shows on
  // EVERY tracking scan (a workspace is almost always already mounted), rendered
  // above the workspace (z-20) so it overlays the previously-open line.
  const showScanLoader = !!scanInFlight && !isTableOnlyMode;
  const emptyState = RECEIVING_EMPTY_STATE[mode];

  return (
    <RightPaneOverlayHost className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* History list — always mounted to keep its react-query cache, in-progress
          search results, and scroll position alive across tab flips. Hidden (not
          unmounted) in Receiving so the auto-select / first-mount effects don't
          re-fire on every close. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ display: isTableOnlyMode ? 'block' : 'none' }}
        aria-hidden={!isTableOnlyMode}
      >
        <ReceivingLinesTable selectMode={selectMode} />
      </div>

      {/* Empty right pane — per-mode copy from RECEIVING_EMPTY_STATE. Sits under
          the workspace/loader overlays (no z), so it only shows when neither is
          mounted. */}
      {!isTableOnlyMode && !showWorkspace && !showScanLoader && emptyState ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <EmptyState
            icon={<Barcode className="h-7 w-7 text-gray-400" />}
            title={emptyState.title}
            description={emptyState.description}
          />
        </div>
      ) : null}

      {/* Scan-in-flight skeleton loader — shown the moment a tracking scan is
          submitted; cleared 500ms after the response lands. */}
      {showScanLoader ? (
        // With a workspace already mounted behind, start BELOW its 80px header
        // chrome (40px stepper + 40px toolbar) so those rows stay visible and the
        // loader reads as a clean white body. Cold start fills from the top.
        <div
          className={`absolute inset-x-0 bottom-0 z-20 overflow-hidden ${
            showWorkspace ? 'top-[80px]' : 'top-0'
          }`}
        >
          <ReceivingScanLoader
            tracking={scanInFlight!.tracking}
            startedAt={scanInFlight!.startedAt}
          />
        </div>
      ) : null}

      {/* Workspace — overlays everything when a line is active in Receiving. */}
      <AnimatePresence initial={false}>
        {showWorkspace ? (
          <motion.div
            key={`workspace-${workspace!.row.id}`}
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: motionBezier.easeOut }}
            className="absolute inset-0 z-10"
          >
            <ReceivingLineWorkspace
              row={workspace!.row}
              staffId={staffId}
              accordionBootstrap={workspace!.accordionBootstrap}
              scanDriven={workspace!.scanDriven}
              nav={nav}
              variant={isTriageMode ? 'triage' : 'unbox'}
              onPrev={() => {
                window.dispatchEvent(
                  new CustomEvent('receiving-navigate-table', { detail: 'prev' }),
                );
              }}
              onNext={() => {
                window.dispatchEvent(
                  new CustomEvent('receiving-navigate-table', { detail: 'next' }),
                );
              }}
              onClose={onCloseWorkspace}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Incoming details panel — right slide-over. A stable key keeps it mounted
          as rows flip so only the contents swap. */}
      <AnimatePresence initial={false}>
        {isIncomingMode && incomingDetails ? (
          <IncomingDetailsPanel
            key="incoming-details-panel"
            zohoPurchaseOrderId={incomingDetails.poId}
            poNumberHint={incomingDetails.poNumber}
            shipmentId={incomingDetails.shipmentId}
            onClose={onCloseIncoming}
          />
        ) : null}
      </AnimatePresence>

      {/* Bulk-selection action bar — pins to the bottom of the list region when
          rows are selected in History / Incoming. */}
      {isTableOnlyMode ? (
        <ContextualSelectionBar
          scope={RECEIVING_SELECTION_SCOPE}
          rows={selectedRows}
          actions={bulkActions}
        />
      ) : null}
    </RightPaneOverlayHost>
  );
}
