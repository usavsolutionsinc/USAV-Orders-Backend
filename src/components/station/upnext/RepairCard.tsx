'use client';

import { motion } from 'framer-motion';
import { ExternalLink, Wrench } from '@/components/Icons';
import type { RepairQueueItem } from './upnext-types';

function getRepairAge(dateTime: string): string {
  if (!dateTime) return '';
  try {
    const parsed = typeof dateTime === 'string' && dateTime.startsWith('"') ? JSON.parse(dateTime) : dateTime;
    const dt = typeof parsed === 'object' && parsed?.start ? parsed.start : parsed;
    const ms = Date.now() - new Date(dt).getTime();
    const days = Math.floor(ms / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    return `${days}d ago`;
  } catch {
    return '';
  }
}

interface RepairCardProps {
  repair: RepairQueueItem;
}

export function RepairCard({ repair }: RepairCardProps) {
  const ticketShort   = repair.ticketNumber ? repair.ticketNumber.slice(-4) : '????';
  const customerName  = repair.contactInfo ? repair.contactInfo.split(',')[0]?.trim() : '';
  const customerPhone = repair.contactInfo ? repair.contactInfo.split(',')[1]?.trim() : '';
  const age           = getRepairAge(repair.dateTime);
  const isUnassigned  = repair.assignedTechId === null;
  const repairAgeLabel = age || 'Repair';

  const openRepair = () => {
    window.dispatchEvent(new CustomEvent('open-repair-details', {
      detail: {
        repairId:       repair.repairId,
        assignmentId:   repair.assignmentId,
        assignedTechId: repair.assignedTechId,
      },
    }));
  };

  return (
    <motion.div
      key={`repair-${repair.repairId}`}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      onClick={openRepair}
      className={`border-b-2 px-0 py-3 transition-colors cursor-pointer ${
        isUnassigned
          ? 'border-orange-400 bg-white hover:border-orange-500'
          : 'border-orange-300 bg-white hover:border-orange-500'
      }`}
    >
      <div className="flex items-center justify-between mb-4 px-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[14px] font-black text-gray-900">
            <Wrench className="w-4 h-4 text-orange-600" />
            {repairAgeLabel}
          </span>
        </div>
        <span className="inline-flex items-center rounded-lg border border-orange-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-900">
          Repair
        </span>
      </div>

      <div className="mb-4 px-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-black text-gray-900">1</span>
            <span className="text-[13px] font-black uppercase tracking-wider text-gray-500">-</span>
            <span className="text-[13px] font-black uppercase truncate text-gray-900">Repair</span>
          </div>
          <span className="text-[13px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
            #{ticketShort}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight">
          {repair.productTitle || 'Unknown Product'}
        </h4>
      </div>

      {repair.issue && (
        <div className="mb-4 mx-3 rounded-xl border border-orange-200 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-orange-700 mb-1">
            Out Of Stock / Part Issue
          </div>
          <p className="text-sm text-gray-900 break-words whitespace-pre-wrap">
            {repair.issue}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 pt-2 border-t border-orange-200">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black text-gray-900 truncate">
            {customerName || repair.techName || 'Repair Queue'}
          </div>
          <div className="text-[10px] text-gray-500 truncate">
            {customerPhone || repair.serialNumber || (isUnassigned ? 'Tap to assign tech' : repair.techName || '')}
          </div>
        </div>
        {repair.price && <span className="text-[11px] font-black text-gray-900">${repair.price}</span>}
        <button
          onClick={(e) => { e.stopPropagation(); openRepair(); }}
          className="flex items-center gap-1 px-3 py-1.5 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ml-auto bg-orange-600 hover:bg-orange-700"
        >
          <ExternalLink className="w-3 h-3" />
          {isUnassigned ? 'Assign' : 'Open'}
        </button>
      </div>
    </motion.div>
  );
}
