'use client';

/**
 * Page-level overlays for the tech dashboard: the receiving details stack (when
 * an inbound log is selected), the repair details panel + its loading veil (from
 * repair-card clicks), and the single-line support-claim modal (from the
 * testing-history bulk bar). Pure presentational; state + handlers come from the
 * dashboard's hooks. Extracted from TechDashboard; behaviour is unchanged.
 */

import { AnimatePresence } from 'framer-motion';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingDetailsStack } from '@/components/station/ReceivingDetailsStack';
import { RepairDetailsPanel } from '@/components/repair/RepairDetailsPanel';
import { toast } from '@/lib/toast';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import type { TechRepairPanel } from '@/components/tech/useTechDetailOverlays';

interface TechDashboardOverlaysProps {
  selectedLog: ReceivingDetailsLog | null;
  onCloseLog: () => void;
  onLogUpdated: () => void;
  onLogDeleted: () => void;
  repairPanel: TechRepairPanel | null;
  onCloseRepair: () => void;
  loadingRepair: boolean;
  testingClaimRow: ReceivingLineRow | null;
  onCloseClaim: () => void;
  onClaimFiled: () => void;
}

export function TechDashboardOverlays({
  selectedLog,
  onCloseLog,
  onLogUpdated,
  onLogDeleted,
  repairPanel,
  onCloseRepair,
  loadingRepair,
  testingClaimRow,
  onCloseClaim,
  onClaimFiled,
}: TechDashboardOverlaysProps) {
  return (
    <>
      {/* ReceivingDetailsStack — shown when a receiving log is selected from the inbound feed */}
      <AnimatePresence>
        {selectedLog && (
          <ReceivingDetailsStack
            log={selectedLog}
            onClose={onCloseLog}
            onUpdated={onLogUpdated}
            onDeleted={onLogDeleted}
          />
        )}
      </AnimatePresence>

      {/* RepairDetailsPanel — triggered by repair card clicks anywhere on the page */}
      {loadingRepair && (
        <div className="fixed inset-0 bg-scrim/20 z-panelBackdrop flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin pointer-events-auto" />
        </div>
      )}
      <AnimatePresence>
        {repairPanel && (
          <RepairDetailsPanel
            repair={repairPanel.record}
            assignmentId={repairPanel.assignmentId}
            assignedTechId={repairPanel.assignedTechId}
            onClose={onCloseRepair}
            onUpdate={onCloseRepair}
          />
        )}
      </AnimatePresence>

      {testingClaimRow ? (
        <ReceivingClaimModal
          open
          row={testingClaimRow}
          onClose={onCloseClaim}
          onTicketCreated={(tk) => {
            toast.success(`Claim filed — ${tk}`);
            onClaimFiled();
          }}
        />
      ) : null}
    </>
  );
}
