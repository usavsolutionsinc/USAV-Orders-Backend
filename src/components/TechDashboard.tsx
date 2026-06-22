'use client';

/**
 * Tech dashboard — thin composition layer.
 *
 * Logic lives in focused hooks under `@/components/tech/`:
 *   - useTechRightView ........... `?view=` → right-pane mode
 *   - useTechTestingSelection .... testing-history pencil multi-select + actions
 *   - useTechOrderPanes .......... active-order + Up Next preview (event bridges)
 *   - useTechDetailOverlays ...... selected log + repair panel (event bridges)
 *
 * Render is pure composition: <TechRightPane> (the mode-swapped right pane) +
 * the testing-history selection bar, then the page-level <TechDashboardOverlays>.
 */

import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { RightPaneOverlayHost } from '@/components/ui/RightPaneOverlay';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { TESTING_SELECTION_SCOPE } from '@/components/tech/TestingHistoryList';
import { StationDetailsHandler } from '@/components/station/StationDetailsHandler';
import { useTechRightView } from '@/components/tech/useTechRightView';
import { useTechTestingSelection } from '@/components/tech/useTechTestingSelection';
import { useTechOrderPanes } from '@/components/tech/useTechOrderPanes';
import { useTechDetailOverlays } from '@/components/tech/useTechDetailOverlays';
import { TechRightPane } from '@/components/tech/TechRightPane';
import { TechDashboardOverlays } from '@/components/tech/TechDashboardOverlays';

interface TechDashboardProps {
  techId: string;
}

export default function TechDashboard({ techId }: TechDashboardProps) {
  const prefersReducedMotion = useReducedMotion();
  const { rightViewMode, isTestingHistory } = useTechRightView();

  const {
    testingSelectMode,
    testingSelectedRows,
    testingClaimRow,
    setTestingClaimRow,
    exitTestingSelect,
    openTestingLine,
    testingBulkActions,
  } = useTechTestingSelection(isTestingHistory);

  const { activeOrderPane, setActiveOrderPane, previewOrder, setPreviewOrder } = useTechOrderPanes();

  const {
    selectedLog,
    setSelectedLog,
    repairPanel,
    setRepairPanel,
    loadingRepair,
    handleLogUpdated,
    handleLogDeleted,
  } = useTechDetailOverlays();

  // Currently-selected receiving line id for the testing pane. Lives at dashboard
  // level so the sidebar's recent rail (rendered in TechSidebarPanel) can
  // highlight the same row the workspace shows.
  const [testingLineId, setTestingLineId] = useState<number | null>(null);

  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <RightPaneOverlayHost className="relative flex h-full min-h-0 flex-col overflow-hidden">
            <TechRightPane
              rightViewMode={rightViewMode}
              techId={techId}
              testingLineId={testingLineId}
              onTestingLineChange={setTestingLineId}
              testingSelectMode={testingSelectMode}
              onOpenTestingLine={openTestingLine}
              activeOrderPane={activeOrderPane}
              onCloseActiveOrder={() => setActiveOrderPane(null)}
              previewOrder={previewOrder}
              onClosePreview={() => setPreviewOrder(null)}
              prefersReducedMotion={prefersReducedMotion}
              onSelectLog={setSelectedLog}
            />
            {isTestingHistory ? (
              <ContextualSelectionBar
                scope={TESTING_SELECTION_SCOPE}
                rows={testingSelectedRows}
                actions={testingBulkActions}
              />
            ) : null}
          </RightPaneOverlayHost>
        </div>
      </div>

      <StationDetailsHandler viewMode="history" />

      <TechDashboardOverlays
        selectedLog={selectedLog}
        onCloseLog={() => setSelectedLog(null)}
        onLogUpdated={handleLogUpdated}
        onLogDeleted={handleLogDeleted}
        repairPanel={repairPanel}
        onCloseRepair={() => setRepairPanel(null)}
        loadingRepair={loadingRepair}
        testingClaimRow={testingClaimRow}
        onCloseClaim={() => setTestingClaimRow(null)}
        onClaimFiled={() => {
          setTestingClaimRow(null);
          exitTestingSelect();
        }}
      />
    </div>
  );
}
