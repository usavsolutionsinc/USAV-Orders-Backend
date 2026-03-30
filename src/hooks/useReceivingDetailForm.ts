'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReceivingDetailsLog } from '@/components/station/ReceivingDetailsStack';
import { getActiveStaff } from '@/lib/staffCache';

type StaffOption = {
  id: number;
  name: string;
};

type SaveState = 'idle' | 'saved' | 'error';

export interface ReceivingDetailFormActions {
  tracking: string;
  setTracking: (v: string) => void;
  carrier: string;
  setCarrier: (v: string) => void;
  qaStatus: string;
  setQaStatus: (v: string) => void;
  dispositionCode: string;
  setDispositionCode: (v: string) => void;
  conditionGrade: string;
  setConditionGrade: (v: string) => void;
  returnPlatform: string;
  setReturnPlatform: (v: string) => void;
  returnReason: string;
  setReturnReason: (v: string) => void;
  needsTest: boolean;
  setNeedsTest: (v: boolean) => void;
  assignedTechId: string;
  setAssignedTechId: (v: string) => void;
  targetChannel: string;
  setTargetChannel: (v: string) => void;
  isReturn: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  saveState: SaveState;
  techs: StaffOption[];
  channelScrollRef: React.RefObject<HTMLDivElement>;
  handleChannelWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  handleSave: () => Promise<void>;
  handleClose: () => Promise<void>;
  handleDelete: () => Promise<void>;
}

function normalizeCarrierValue(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  const normalized = raw.toUpperCase();
  if (normalized === 'FEDEX') return 'FedEx';
  if (normalized === 'UPS') return 'UPS';
  if (normalized === 'USPS') return 'USPS';
  if (normalized === 'AMAZON') return 'AMAZON';
  if (normalized === 'DHL') return 'DHL';
  if (normalized === 'ALIEXPRESS') return 'AliExpress';
  if (normalized === 'GOFO') return 'GoFo';
  if (normalized === 'UNIUNI') return 'UniUni';
  if (normalized === 'LOCAL') return 'LOCAL';
  return raw;
}

export function normalizeCarrier(value: string | null | undefined): string {
  return normalizeCarrierValue(value);
}

interface UseReceivingDetailFormOptions {
  log: ReceivingDetailsLog;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

export function useReceivingDetailForm({
  log,
  onClose,
  onUpdated,
  onDeleted,
}: UseReceivingDetailFormOptions): ReceivingDetailFormActions {
  const [tracking, setTracking]               = useState(log.tracking || '');
  const [carrier, setCarrier]                 = useState(normalizeCarrierValue(log.status));
  const [qaStatus, setQaStatus]               = useState((log.qa_status || 'PENDING').toUpperCase());
  const [dispositionCode, setDispositionCode] = useState((log.disposition_code || 'ACCEPT').toUpperCase());
  const [conditionGrade, setConditionGrade]   = useState((log.condition_grade || 'BRAND_NEW').toUpperCase());
  const [returnPlatform, setReturnPlatform]   = useState((log.return_platform || '').toUpperCase());
  const [returnReason, setReturnReason]       = useState(log.return_reason || '');
  const [needsTest, setNeedsTest]             = useState(log.needs_test !== false);
  const [assignedTechId, setAssignedTechId]   = useState(log.assigned_tech_id ? String(log.assigned_tech_id) : '');
  const [targetChannel, setTargetChannel]     = useState((log.target_channel || 'ORDERS').toUpperCase());
  const [isSaving, setIsSaving]               = useState(false);
  const [isDeleting, setIsDeleting]           = useState(false);
  const [saveState, setSaveState]             = useState<SaveState>('idle');
  const [techs, setTechs]                     = useState<StaffOption[]>([]);

  const isReturn = targetChannel === 'RETURN';

  const channelScrollRef = useRef<HTMLDivElement>(null!);
  const handleChannelWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (channelScrollRef.current) channelScrollRef.current.scrollLeft += e.deltaY;
  };

  // Load technicians once
  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => {
        if (!active) return;
        setTechs(
          data
            .filter((m) => m.role === 'technician')
            .map((m) => ({ id: m.id, name: m.name })),
        );
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Sync fields when the log prop changes
  useEffect(() => {
    setTracking(log.tracking || '');
    setCarrier(normalizeCarrierValue(log.status));
    setQaStatus((log.qa_status || 'PENDING').toUpperCase());
    setDispositionCode((log.disposition_code || 'ACCEPT').toUpperCase());
    setConditionGrade((log.condition_grade || 'BRAND_NEW').toUpperCase());
    setReturnPlatform((log.return_platform || '').toUpperCase());
    setReturnReason(log.return_reason || '');
    setNeedsTest(log.needs_test !== false);
    setAssignedTechId(log.assigned_tech_id ? String(log.assigned_tech_id) : '');
    const ch = (log.target_channel || 'ORDERS').toUpperCase();
    setTargetChannel(log.is_return && ch !== 'RETURN' ? 'RETURN' : ch);
    setSaveState('idle');
  }, [log]);

  // REPAIR channel auto-enables test and assigns tech 1.
  // We intentionally only set state when entering REPAIR to avoid overriding
  // the needs_test default (true) that applies to all new receiving entries.
  useEffect(() => {
    if (targetChannel === 'REPAIR') {
      setNeedsTest(true);
      setAssignedTechId('1');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetChannel]);

  const handleSave = async () => {
    if (!tracking.trim()) return;
    setIsSaving(true);
    setSaveState('idle');
    try {
      const techIdNum = Number(assignedTechId);
      const res = await fetch('/api/receiving-logs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(log.id),
          tracking: tracking.trim(),
          status: normalizeCarrierValue(carrier),
          qa_status: qaStatus,
          disposition_code: dispositionCode,
          condition_grade: conditionGrade,
          is_return: isReturn,
          return_platform: isReturn ? returnPlatform || null : null,
          return_reason: isReturn ? returnReason.trim() || null : null,
          needs_test: needsTest,
          assigned_tech_id: needsTest && Number.isFinite(techIdNum) && techIdNum > 0 ? techIdNum : null,
          target_channel: targetChannel || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to update receiving log');
      setSaveState('saved');
      onUpdated();
    } catch (error) {
      console.error('Failed to update receiving log:', error);
      setSaveState('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = async () => {
    await handleSave();
    onClose();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/receiving-logs?id=${encodeURIComponent(log.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to delete receiving log');
      onDeleted(log.id);
    } catch (error) {
      console.error('Failed to delete receiving log:', error);
      window.alert('Failed to delete receiving log.');
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    tracking, setTracking,
    carrier, setCarrier,
    qaStatus, setQaStatus,
    dispositionCode, setDispositionCode,
    conditionGrade, setConditionGrade,
    returnPlatform, setReturnPlatform,
    returnReason, setReturnReason,
    needsTest, setNeedsTest,
    assignedTechId, setAssignedTechId,
    targetChannel, setTargetChannel,
    isReturn,
    isSaving,
    isDeleting,
    saveState,
    techs,
    channelScrollRef,
    handleChannelWheel,
    handleSave,
    handleClose,
    handleDelete,
  };
}
