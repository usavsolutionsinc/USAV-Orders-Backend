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
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import ReceivingLinesTable from '@/components/station/ReceivingLinesTable';
import { RECEIVING_SELECTION_SCOPE } from '@/components/station/ReceivingLinesTable';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { RightPaneOverlayHost } from '@/components/ui/RightPaneOverlay';
import { EmptyState } from '@/design-system/primitives';
import { Barcode } from '@/components/Icons';
import { ReceivingLineWorkspace } from '@/components/receiving/workspace/ReceivingLineWorkspace';
import { ReceivingScanLoader } from '@/components/receiving/workspace/ReceivingScanLoader';
import { IncomingDetailsPanel } from '@/components/sidebar/receiving/IncomingDetailsPanel';
import { EmailTriagePanel } from '@/components/receiving/EmailTriagePanel';
import { IncomingViewBand } from '@/components/receiving/IncomingViewBand';
import type { IncomingView } from '@/components/receiving/EmailTriagePanel';
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
  /** Incoming right-pane sub-view (`?incview=`): the POS table or Email Triage. */
  incomingView: IncomingView;
  /** Write the chosen Incoming sub-view to the URL. */
  onIncomingViewChange: (next: IncomingView) => void;
  selectMode: boolean;
  selectedRows: ReceivingLineRow[];
  bulkActions: SelectionAction<ReceivingLineRow>[];
  workspace: WorkspaceState | null;
  nav: NavState | null;
  scanInFlight: { tracking: string; startedAt: number } | null;
  staffId: string;
  incomingDetails: IncomingDetailsTarget | null;
  onCloseIncoming: () => void;
  onCloseWorkspace: () => void;
}

export function ReceivingRightPane({
  mode,
  isTableOnlyMode,
  isTriageMode,
  isIncomingMode,
  incomingView,
  onIncomingViewChange,
  selectMode,
  selectedRows,
  bulkActions,
  workspace,
  nav,
  scanInFlight,
  staffId,
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
  // Canonical workbench right-pane crossfade; the hook collapses it to
  // opacity-only under prefers-reduced-motion (no local branching).
  const workspacePane = useMotionPresence(framerPresence.workbenchPane);
  const workspaceTransition = useMotionTransition(framerTransition.workbenchPaneMount);

  // Incoming hosts two right-pane sub-views toggled by the band (`?incview=`):
  // the POS table (default) and the Email Triage worklist. The table stays
  // mounted (cache + scroll); Email Triage crossfades in over it, both sitting
  // below the 45px toggle band.
  const showEmailTriage = isIncomingMode && incomingView === 'email';
  const showTable = isTableOnlyMode && !showEmailTriage;

  return (
    <RightPaneOverlayHost className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Incoming sub-view toggle: Incoming POS (n) | Email Triage (n). Pinned
          above both sub-views; its count hooks poll only while mounted here. */}
      {isIncomingMode ? (
        <div className="absolute inset-x-0 top-0 z-30">
          <IncomingViewBand value={incomingView} onChange={onIncomingViewChange} />
        </div>
      ) : null}

      {/* History/Incoming-POS table — always mounted to keep its react-query
          cache, in-progress search results, and scroll position alive across tab
          flips. Hidden (not unmounted) in Receiving so the auto-select /
          first-mount effects don't re-fire on every close. In Incoming it sits
          below the toggle band. */}
      <div
        className={`overflow-hidden ${isIncomingMode ? 'absolute inset-x-0 bottom-0 top-[45px]' : 'absolute inset-0'}`}
        style={{ display: showTable ? 'block' : 'none' }}
        aria-hidden={!showTable}
      >
        <ReceivingLinesTable selectMode={selectMode} />
      </div>

      {/* Email Triage worklist — crossfades in over the (hidden) table on
          `?incview=email`, via the canonical workbench right-pane preset. */}
      <AnimatePresence initial={false}>
        {showEmailTriage ? (
          <motion.div
            key="incoming-email-triage"
            initial={workspacePane.initial}
            animate={workspacePane.animate}
            exit={workspacePane.exit}
            transition={workspaceTransition}
            className="absolute inset-x-0 bottom-0 top-[45px] z-10 overflow-hidden"
          >
            <EmailTriagePanel />
          </motion.div>
        ) : null}
      </AnimatePresence>

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
            // Key on the CARTON, not the line. Switching between sibling lines of
            // the same carton (receiving_id) must NOT remount/crossfade the whole
            // workspace — only a carton→carton change should. The controller
            // re-seeds per-line state on row.id change in place, so an in-place
            // line switch is both faster and more correct (carton-level PO#,
            // tracking, photos stay put). Fall back to the line id for rows with
            // no carton yet (pre-carton stub).
            key={`workspace-${workspace!.row.receiving_id ?? `line-${workspace!.row.id}`}`}
            initial={workspacePane.initial}
            animate={workspacePane.animate}
            exit={workspacePane.exit}
            transition={workspaceTransition}
            className="absolute inset-0 z-10"
          >
            {/* Triage reuses the SAME workspace shell as Unbox — the variant
                gates unbox-only sections and turns on the Smart-Matching section
                (see workspace-capabilities + LineEditPanel). */}
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
        {isIncomingMode && incomingView === 'pos' && incomingDetails ? (
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
          rows are selected in History / Incoming-POS (never over Email Triage). */}
      {showTable ? (
        <ContextualSelectionBar
          scope={RECEIVING_SELECTION_SCOPE}
          rows={selectedRows}
          actions={bulkActions}
        />
      ) : null}
    </RightPaneOverlayHost>
  );
}
