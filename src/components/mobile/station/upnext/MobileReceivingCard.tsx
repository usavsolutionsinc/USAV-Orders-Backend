'use client';

import { motion } from 'framer-motion';
import { ExternalLink, Package } from '@/components/Icons';
import { framerPresenceMobile, framerTransitionMobile } from '@/design-system';
import type { ReceivingQueueItem } from '@/components/station/upnext/upnext-types';
import { workflowStatusTableLabel } from '@/components/station/receiving-constants';

/* ── Helpers (same logic as desktop ReceivingAssignmentCard) ────────────────── */

const WORKFLOW_COLORS: Record<string, string> = {
  EXPECTED:      'bg-gray-100 text-gray-500 border-gray-200',
  ARRIVED:       'bg-blue-100 text-blue-600 border-blue-200',
  MATCHED:       'bg-indigo-100 text-indigo-700 border-indigo-200',
  UNBOXED:       'bg-yellow-100 text-yellow-700 border-yellow-200',
  AWAITING_TEST: 'bg-orange-100 text-orange-700 border-orange-200',
  IN_TEST:       'bg-teal-100 text-teal-700 border-teal-200',
  PASSED:        'bg-emerald-100 text-emerald-700 border-emerald-200',
  FAILED:        'bg-red-100 text-red-700 border-red-200',
  DONE:          'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function assignedAgo(assignedAt: string | null): string | null {
  if (!assignedAt) return null;
  const ms   = Date.now() - new Date(assignedAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Props (same as desktop) ────────────────────────────────────────────────── */

interface MobileReceivingCardProps {
  item: ReceivingQueueItem;
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function MobileReceivingCard({ item }: MobileReceivingCardProps) {
  const statusCls = WORKFLOW_COLORS[item.workflow_status ?? ''] || 'bg-gray-100 text-gray-500 border-gray-200';
  const ago = assignedAgo(item.assigned_at);

  const openReceiving = () => {
    window.dispatchEvent(new CustomEvent('open-receiving-details', {
      detail: { receivingId: item.receiving_id, assignmentId: item.assignment_id },
    }));
  };

  return (
    <motion.div
      key={`recv-${item.assignment_id}`}
      initial={framerPresenceMobile.mobileCard.initial}
      animate={framerPresenceMobile.mobileCard.animate}
      exit={framerPresenceMobile.mobileCard.exit}
      transition={framerTransitionMobile.mobileCardMount}
      onClick={openReceiving}
      className="rounded-2xl border mb-2 px-0 py-3 border-teal-300 bg-white active:border-teal-500 transition-colors"
    >
      {/* -- Header -- */}
      <div className="flex items-center justify-between mb-4 px-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[15px] font-black text-gray-900">
            <Package className="w-5 h-5 text-teal-600" />
            <span>{ago || 'Receiving'}</span>
          </div>
        </div>
        <span className="inline-flex items-center rounded-lg border border-teal-200 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-gray-900">
          Receiving
        </span>
      </div>

      {/* -- Body -- */}
      <div className="mb-4 px-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px] font-black text-gray-900">{item.line_count || 1}</span>
            <span className="text-[14px] font-black uppercase tracking-wider text-gray-500">-</span>
            <span className="text-[14px] font-black uppercase truncate text-gray-900">
              {workflowStatusTableLabel(item.workflow_status)}
            </span>
          </div>
          <span className="text-[14px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
            #{item.receiving_id}
          </span>
        </div>
        <h4 className="text-[17px] font-black text-gray-900 leading-tight">
          {item.tracking_number || 'Receiving Assignment'}
        </h4>
      </div>

      {/* -- Details block -- */}
      {(item.line_skus.length > 0 || item.carrier || item.qa_status) && (
        <div className="mb-4 mx-3 rounded-xl border border-teal-200 px-3 py-2.5">
          <div className="text-[11px] font-black uppercase tracking-widest text-teal-700 mb-1">
            Receiving Details
          </div>
          <p className="text-[15px] text-gray-900 break-words whitespace-pre-wrap">
            {[
              item.carrier ? `Carrier: ${item.carrier}` : null,
              item.qa_status ? `QA: ${item.qa_status}` : null,
              item.line_skus.length > 0 ? `SKUs: ${item.line_skus.join(', ')}${item.line_count > item.line_skus.length ? '\u2026' : ''}` : null,
            ].filter(Boolean).join(' \u2022 ')}
          </p>
        </div>
      )}

      {/* -- Footer -- */}
      <div className="flex items-center gap-2 px-3 pt-2 border-t border-teal-200">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black text-gray-900 truncate">
            {item.assigned_tech_name || 'Receiving Queue'}
          </div>
          <div className="text-[11px] text-gray-500 truncate">
            {workflowStatusTableLabel(item.workflow_status)}
          </div>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest border rounded-lg px-2 py-0.5 ${statusCls}`}>
          {workflowStatusTableLabel(item.workflow_status)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); openReceiving(); }}
          className="flex items-center gap-1 min-h-[44px] px-4 py-2 bg-teal-600 active:bg-teal-700 active:scale-95 text-white rounded-xl text-[11px] font-black uppercase tracking-widest transition-transform ml-auto"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open
        </button>
      </div>
    </motion.div>
  );
}
