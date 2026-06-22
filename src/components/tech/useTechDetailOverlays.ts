'use client';

/**
 * Detail-overlay state for the tech dashboard: the selected receiving log (from
 * inbound-feed row clicks) and the repair panel (from repair-card clicks
 * anywhere on the page), plus the receiving-log query invalidations. Owns the
 * `open-repair-details` + `receiving-select-log` window-event bridges. Extracted
 * from TechDashboard; behaviour is unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';

interface OpenRepairDetail {
  repairId: number;
  assignmentId: number | null;
  assignedTechId: number | null;
}

export interface TechRepairPanel {
  record: RSRecord;
  assignmentId: number | null;
  assignedTechId: number | null;
}

export interface TechDetailOverlays {
  selectedLog: ReceivingDetailsLog | null;
  setSelectedLog: React.Dispatch<React.SetStateAction<ReceivingDetailsLog | null>>;
  repairPanel: TechRepairPanel | null;
  setRepairPanel: React.Dispatch<React.SetStateAction<TechRepairPanel | null>>;
  loadingRepair: boolean;
  handleLogUpdated: () => void;
  handleLogDeleted: () => void;
}

export function useTechDetailOverlays(): TechDetailOverlays {
  const queryClient = useQueryClient();
  const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
  const [repairPanel, setRepairPanel] = useState<TechRepairPanel | null>(null);
  const [loadingRepair, setLoadingRepair] = useState(false);

  // Repair card clicks dispatched by RepairCard (inside the sidebar).
  useEffect(() => {
    const handleOpenRepair = async (e: Event) => {
      const { repairId, assignmentId, assignedTechId } = (e as CustomEvent<OpenRepairDetail>).detail;
      setLoadingRepair(true);
      try {
        const res = await fetch(`/api/repair-service/${repairId}`);
        if (res.ok) {
          const data = await res.json();
          const record: RSRecord = data.repair ?? data;
          setRepairPanel({ record, assignmentId, assignedTechId });
        }
      } catch (err) {
        console.error('Error loading repair details:', err);
      } finally {
        setLoadingRepair(false);
      }
    };
    window.addEventListener('open-repair-details', handleOpenRepair);
    return () => window.removeEventListener('open-repair-details', handleOpenRepair);
  }, []);

  // receiving-select-log events (fired by ReceivingInboundFeed row clicks).
  useEffect(() => {
    const handleSelectLog = (e: Event) => {
      const custom = e as CustomEvent<ReceivingDetailsLog>;
      if (custom.detail) setSelectedLog(custom.detail);
    };
    window.addEventListener('receiving-select-log', handleSelectLog);
    return () => window.removeEventListener('receiving-select-log', handleSelectLog);
  }, []);

  const handleLogUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-inbound-feed'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
  }, [queryClient]);

  const handleLogDeleted = useCallback(() => {
    setSelectedLog(null);
    queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-inbound-feed'] });
    queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
  }, [queryClient]);

  return {
    selectedLog,
    setSelectedLog,
    repairPanel,
    setRepairPanel,
    loadingRepair,
    handleLogUpdated,
    handleLogDeleted,
  };
}
