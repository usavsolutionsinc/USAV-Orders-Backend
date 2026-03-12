'use client';

import { motion } from 'framer-motion';
import { Loader2, Package, Trash2, X } from '@/components/Icons';
import { formatDateTimePST } from '@/utils/date';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { PoLinesSection } from './receiving/PoLinesSection';
import { ReceivingPhotosSection } from './receiving/ReceivingPhotosSection';
import { useReceivingDetailForm, normalizeCarrier } from '@/hooks/useReceivingDetailForm';

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
const CONDITION_OPTS = ['BRAND_NEW', 'USED_A', 'USED_B', 'USED_C', 'PARTS'].map((v) => ({
  value: v,
  label: v.replaceAll('_', ' '),
}));
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
          onClick={form.handleClose}
          disabled={form.isSaving}
          className="rounded-2xl border border-transparent p-3 transition-all hover:border-gray-100 hover:bg-gray-50 disabled:opacity-50"
          aria-label="Save and close"
        >
          {form.isSaving ? <Loader2 className="h-6 w-6 animate-spin text-gray-400" /> : <X className="h-6 w-6 text-gray-400" />}
        </button>
      </div>

      <div className="min-h-[calc(100vh-96px)] px-8 py-6">
        <div className="space-y-4">

          <PoLinesSection receivingId={log.id} trackingNumber={log.tracking} />
          <ReceivingPhotosSection receivingId={log.id} />

          {/* Tracking */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Tracking Number</label>
            <input
              type="text"
              value={form.tracking}
              onChange={(e) => form.setTracking(e.target.value)}
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono font-bold text-gray-900 outline-none focus:border-blue-500"
            />
          </div>

          {/* Channel slider */}
          <div
            ref={form.channelScrollRef}
            onWheel={form.handleChannelWheel}
            className="overflow-x-auto w-full"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #ffffff' }}
          >
            <div className="flex gap-1.5 w-max pb-1">
              {CHANNEL_OPTS.map((ch) => (
                <button
                  key={ch.value}
                  type="button"
                  onClick={() => form.setTargetChannel(ch.value)}
                  className={`rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                    form.targetChannel === ch.value ? ch.active : ch.inactive
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

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
            <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-700">
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
                    const theme = getStaffThemeById(tech.id, 'technician');
                    const colors = stationThemeColors[theme];
                    const isActive = form.assignedTechId === String(tech.id);
                    return (
                      <button
                        key={tech.id}
                        type="button"
                        onClick={() => form.setAssignedTechId(String(tech.id))}
                        className={`rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
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
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Condition</label>
              <ViewDropdown options={CONDITION_OPTS} value={form.conditionGrade} onChange={form.setConditionGrade} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Carrier</label>
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
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Disposition</label>
              <ViewDropdown options={DISPOSITION_OPTS} value={form.dispositionCode} onChange={form.setDispositionCode} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">QA Status</label>
              <ViewDropdown options={QA_OPTS} value={form.qaStatus} onChange={form.setQaStatus} borderRadius="12px" backgroundColor="#f9fafb" fontSize="11px" />
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
            {form.saveState === 'error' && (
              <p className="text-center text-[10px] font-black uppercase tracking-wider text-red-500">Save failed — check connection</p>
            )}
            <button
              type="button"
              onClick={form.handleDelete}
              disabled={form.isDeleting}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-[10px] font-black uppercase tracking-wider text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {form.isDeleting ? 'Deleting...' : 'Delete Row'}
            </button>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
