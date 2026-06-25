'use client';

/**
 * The tech dashboard's right pane, swapped by sidebar mode:
 *   - receiving ........ the inbound receiving feed
 *   - testing .......... the Pass/Test-Again verdict workspace
 *   - testing-history .. the browse + bulk-select feed of tested lines
 *   - history (default)  the tech's shipping History table, OVER which a
 *     scanned/active order — or an Up Next preview — crossfades and back.
 * Pure presentational; state comes from the dashboard's hooks. Extracted from
 * TechDashboard; behaviour is unchanged.
 */

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence } from '@/design-system/foundations/motion-framer';
import { useMotionPresence } from '@/design-system/foundations/motion-framer-hooks';
import { TechTable } from '@/components/TechTable';
import { TestingHistoryList } from '@/components/tech/TestingHistoryList';
import { ReceivingInboundFeed } from '@/components/station/ReceivingInboundFeed';
import { ActiveOrderWorkspace } from '@/components/tech/ActiveOrderWorkspace';
import { TestingLineWorkspace } from '@/components/tech/TestingLineWorkspace';
import { previewOrderToActiveShape } from '@/components/tech/tech-dashboard-helpers';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { Order } from '@/components/station/upnext/upnext-types';
import type { TechActiveOrderPane } from '@/components/tech/useTechOrderPanes';
import type { TechRightViewMode } from '@/components/tech/useTechRightView';

interface TechRightPaneProps {
  rightViewMode: TechRightViewMode;
  techId: string;
  testingLineId: number | null;
  onTestingLineChange: React.Dispatch<React.SetStateAction<number | null>>;
  testingSelectMode: boolean;
  onOpenTestingLine: () => void;
  activeOrderPane: TechActiveOrderPane | null;
  onCloseActiveOrder: () => void;
  previewOrder: Order | null;
  onClosePreview: () => void;
  onSelectLog: (log: ReceivingDetailsLog) => void;
}

export function TechRightPane({
  rightViewMode,
  techId,
  testingLineId,
  onTestingLineChange,
  testingSelectMode,
  onOpenTestingLine,
  activeOrderPane,
  onCloseActiveOrder,
  previewOrder,
  onClosePreview,
  onSelectLog,
}: TechRightPaneProps) {
  // Canonical right-pane fade; centralizes prefers-reduced-motion via the hook.
  const tabFade = useMotionPresence(framerPresence.tableRow);
  if (rightViewMode === 'receiving') {
    return <ReceivingInboundFeed onSelectLog={onSelectLog} />;
  }

  if (rightViewMode === 'testing') {
    // Testing mode → the Pass/Test-Again verdict workspace.
    return (
      <TestingLineWorkspace
        staffId={techId}
        selectedLineId={testingLineId}
        onSelectedLineChange={onTestingLineChange}
      />
    );
  }

  if (rightViewMode === 'testing-history') {
    // History mode → the browse + bulk-select feed of this tech's tested lines.
    return (
      <TestingHistoryList
        staffId={techId}
        selectMode={testingSelectMode}
        onOpenLine={onOpenTestingLine}
      />
    );
  }

  // Shipping mode: the right pane is always the tech's History feed; the
  // active/preview order crossfades over it and back.
  return (
    <AnimatePresence initial={false} mode="wait">
      {activeOrderPane ? (
        <ActiveOrderWorkspace
          key={`workspace-active-${activeOrderPane.activeOrder.tracking || activeOrderPane.activeOrder.orderId}`}
          activeOrder={activeOrderPane.activeOrder}
          onClose={onCloseActiveOrder}
        />
      ) : previewOrder ? (
        <ActiveOrderWorkspace
          key={`workspace-preview-${previewOrder.id}`}
          activeOrder={previewOrderToActiveShape(previewOrder)}
          mode="preview"
          previewOrder={previewOrder}
          onClose={onClosePreview}
        />
      ) : (
        <motion.div
          key={`tech-tab-${rightViewMode}`}
          initial={tabFade.initial}
          animate={tabFade.animate}
          exit={tabFade.exit}
          transition={{ duration: 0.16 }}
          className="h-full w-full"
        >
          <TechTable testedBy={parseInt(techId)} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
