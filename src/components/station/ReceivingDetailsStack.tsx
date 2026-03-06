'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2, Package, Trash2, X } from '@/components/Icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTimePST } from '@/lib/timezone';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

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
  zoho_purchase_receive_id?: string | null;
  zoho_warehouse_id?: string | null;
}

type StaffOption = {
  id: number;
  name: string;
};

interface ReceivingDetailsStackProps {
  log: ReceivingDetailsLog;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
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

function fmt(value: string) {
  return value ? value.replaceAll('_', ' ') : value;
}

const CARRIER_OPTS = ['Unknown', 'UPS', 'FedEx', 'USPS', 'AMAZON', 'DHL', 'AliExpress', 'GoFo', 'UniUni', 'LOCAL'].map(
  (v) => ({ value: v, label: v }),
);
const QA_OPTS = [
  { value: 'PENDING',           label: 'Pending' },
  { value: 'PASSED',            label: 'Passed' },
  { value: 'FAILED_DAMAGED',    label: 'Failed Damaged' },
  { value: 'FAILED_INCOMPLETE', label: 'Failed Incomplete' },
  { value: 'FAILED_FUNCTIONAL', label: 'Failed Functional' },
];
const DISPOSITION_OPTS = [
  { value: 'ACCEPT', label: 'Accept' },
  { value: 'HOLD',   label: 'Hold' },
  { value: 'RTV',    label: 'Return to Seller' },
  { value: 'SCRAP',  label: 'Claim' },
  { value: 'REWORK', label: 'Repair' },
];
const CONDITION_OPTS = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'].map((v) => ({ value: v, label: fmt(v) }));
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
  { value: 'ORDERS', label: 'PO',     active: 'bg-emerald-500 text-white',   inactive: 'bg-gray-100 text-gray-500' },
  { value: 'RETURN', label: 'Return', active: 'bg-red-500 text-white',       inactive: 'bg-gray-100 text-gray-500' },
  { value: 'REPAIR', label: 'Repair', active: 'bg-orange-400 text-white',    inactive: 'bg-gray-100 text-gray-500' },
];

// ─── Photos section ───────────────────────────────────────────────────────────

interface ReceivingPhoto {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
}

function ReceivingPhotosSection({ receivingId }: { receivingId: string }) {
  const queryClient = useQueryClient();

  const { data: photos = [], isFetching } = useQuery<ReceivingPhoto[]>({
    queryKey: ['receiving-photos', receivingId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.photos) ? data.photos : [];
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
  });

  const deletePhoto = async (photoId: number) => {
    await fetch(`/api/receiving-photos?id=${photoId}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['receiving-photos', receivingId] });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-gray-400" />
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Photos ({photos.length})
        </span>
        {isFetching && <Loader2 className="h-3 w-3 animate-spin text-gray-300" />}
      </div>

      {photos.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-gray-100 bg-gray-50">
          <div className="text-center">
            <Camera className="mx-auto mb-1 h-5 w-5 text-gray-300" />
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">
              No photos yet
            </p>
            <p className="text-[9px] font-medium text-gray-300">
              Mobile app → Receiving → ID <span className="font-mono font-black">#{receivingId}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.photoUrl} alt={photo.caption || `Photo ${photo.id}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => deletePhoto(photo.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReceivingDetailsStack({ log, onClose, onUpdated, onDeleted }: ReceivingDetailsStackProps) {
  const [tracking, setTracking] = useState(log.tracking || '');
  const [carrier, setCarrier] = useState(normalizeCarrierValue(log.status));
  const [qaStatus, setQaStatus] = useState((log.qa_status || 'PENDING').toUpperCase());
  const [dispositionCode, setDispositionCode] = useState((log.disposition_code || 'ACCEPT').toUpperCase());
  const [conditionGrade, setConditionGrade] = useState((log.condition_grade || 'BRAND_NEW').toUpperCase());
  const [returnPlatform, setReturnPlatform] = useState((log.return_platform || '').toUpperCase());
  const [returnReason, setReturnReason] = useState(log.return_reason || '');
  const [needsTest, setNeedsTest] = useState(!!log.needs_test);
  const [assignedTechId, setAssignedTechId] = useState(log.assigned_tech_id ? String(log.assigned_tech_id) : '');
  const [targetChannel, setTargetChannel] = useState((log.target_channel || 'ORDERS').toUpperCase());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [techs, setTechs] = useState<StaffOption[]>([]);

  // Return is driven entirely by channel=RETURN
  const isReturn = targetChannel === 'RETURN';


  const channelScrollRef = useRef<HTMLDivElement>(null);
  const handleChannelWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (channelScrollRef.current) channelScrollRef.current.scrollLeft += e.deltaY;
  };

  useEffect(() => {
    const loadTechs = async () => {
      try {
        const res = await fetch('/api/staff?role=technician&active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const rows = await res.json();
        if (!Array.isArray(rows)) return;
        setTechs(
          rows
            .map((row: any) => ({ id: Number(row.id), name: String(row.name || '') }))
            .filter((row: StaffOption) => Number.isFinite(row.id) && row.id > 0 && row.name)
        );
      } catch {
        // no-op
      }
    };
    loadTechs();
  }, []);

  useEffect(() => {
    setTracking(log.tracking || '');
    setCarrier(normalizeCarrierValue(log.status));
    setQaStatus((log.qa_status || 'PENDING').toUpperCase());
    setDispositionCode((log.disposition_code || 'ACCEPT').toUpperCase());
    setConditionGrade((log.condition_grade || 'BRAND_NEW').toUpperCase());
    setReturnPlatform((log.return_platform || '').toUpperCase());
    setReturnReason(log.return_reason || '');
    setNeedsTest(!!log.needs_test);
    setAssignedTechId(log.assigned_tech_id ? String(log.assigned_tech_id) : '');
    // Sync: if is_return flag is set but channel isn't RETURN, normalise to RETURN
    const ch = (log.target_channel || 'ORDERS').toUpperCase();
    setTargetChannel(log.is_return && ch !== 'RETURN' ? 'RETURN' : ch);
    setSaveState('idle');
  }, [log]);

  // REPAIR always needs a test — auto-assign to staff id 1
  useEffect(() => {
    if (targetChannel === 'REPAIR') {
      setNeedsTest(true);
      setAssignedTechId('1');
    } else {
      setNeedsTest(false);
      setAssignedTechId('');
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

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
      className="fixed right-0 top-0 z-[100] h-screen w-[440px] overflow-y-auto border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/90 px-8 py-5 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-200">
            <Package className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-[20px] font-black leading-none tracking-tight text-gray-900">Receiving #{log.id}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">{formatDateTimePST(log.timestamp)}</p>
          </div>
        </div>
        <button
          onClick={handleClose}
          disabled={isSaving}
          className="rounded-2xl border border-transparent p-3 transition-all hover:border-gray-100 hover:bg-gray-50 disabled:opacity-50"
          aria-label="Save and close"
        >
          {isSaving ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : <X className="h-6 w-6 text-gray-400" />}
        </button>
      </div>

      <div className="min-h-[calc(100vh-96px)] px-8 py-6">
        <div className="space-y-4">

          {/* Photos — polls every 3s, used during unboxing */}
          <ReceivingPhotosSection receivingId={log.id} />

          {/* Tracking */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Tracking Number</label>
            <input
              type="text"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono font-bold text-gray-900 outline-none focus:border-blue-500"
            />
          </div>

          {/* Channel slider */}
          <div
            ref={channelScrollRef}
            onWheel={handleChannelWheel}
            className="overflow-x-auto w-full"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #ffffff' }}
          >
            <div className="flex gap-1.5 w-max pb-1">
              {CHANNEL_OPTS.map((ch) => (
                <button
                  key={ch.value}
                  type="button"
                  onClick={() => setTargetChannel(ch.value)}
                  className={`rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                    targetChannel === ch.value ? ch.active : ch.inactive
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          {/* Return details — shown when channel = RETURN */}
          {isReturn && (
            <div className="space-y-2">
              <ViewDropdown options={RETURN_PLATFORM_OPTS} value={returnPlatform} onChange={setReturnPlatform} borderRadius="12px" backgroundColor="#ffffff" fontSize="11px" />
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Return reason"
                className="min-h-[60px] w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-gray-400"
              />
            </div>
          )}

          {/* Needs Test — auto-shown for REPAIR, manual checkbox otherwise */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-700">
              <input
                type="checkbox"
                checked={needsTest}
                onChange={(e) => setNeedsTest(e.target.checked)}
                disabled={targetChannel === 'REPAIR'}
              />
              Needs Test
            </label>
            {needsTest && techs.length > 0 && (
              <div
                ref={channelScrollRef}
                onWheel={handleChannelWheel}
                className="overflow-x-auto w-full"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #f9fafb' }}
              >
                <div className="flex gap-1.5 w-max pb-1">
                  {techs.map((tech) => {
                    const theme = getStaffThemeById(tech.id, 'technician');
                    const colors = stationThemeColors[theme];
                    const isActive = assignedTechId === String(tech.id);
                    return (
                      <button
                        key={tech.id}
                        type="button"
                        onClick={() => setAssignedTechId(String(tech.id))}
                        className={`rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                          isActive
                            ? `${colors.bg} text-white`
                            : `bg-gray-100 ${colors.text} hover:${colors.light}`
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
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Condition</label>
              <ViewDropdown options={CONDITION_OPTS} value={conditionGrade} onChange={setConditionGrade} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Carrier</label>
              <ViewDropdown
                options={CARRIER_OPTS.some((o) => o.value === carrier) ? CARRIER_OPTS : [{ value: carrier, label: carrier }, ...CARRIER_OPTS]}
                value={carrier}
                onChange={(v) => setCarrier(normalizeCarrierValue(v))}
                borderRadius="12px"
                backgroundColor="#f9fafb"
                fontSize="11px"
              />
            </div>
          </div>

          {/* Disposition + QA Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Disposition</label>
              <ViewDropdown options={DISPOSITION_OPTS} value={dispositionCode} onChange={setDispositionCode} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">QA Status</label>
              <ViewDropdown options={QA_OPTS} value={qaStatus} onChange={setQaStatus} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
          </div>

          {/* Metadata */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            <p>Received At: {log.received_at ? formatDateTimePST(log.received_at) : '-'}</p>
            <p className="mt-1">Unboxed At: {log.unboxed_at ? formatDateTimePST(log.unboxed_at) : '-'}</p>
            <p className="mt-1">Zoho Receive: {log.zoho_purchase_receive_id || '-'}</p>
          </div>

          {/* Delete */}
          <div className="space-y-2 pb-4">
            {saveState === 'error' && (
              <p className="text-center text-[10px] font-black uppercase tracking-wider text-red-500">Save failed — check connection</p>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[10px] font-black uppercase tracking-wider text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isDeleting ? 'Deleting...' : 'Delete Row'}
            </button>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
