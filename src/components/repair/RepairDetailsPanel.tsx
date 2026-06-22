'use client';

/**
 * Repair details slide-over — thin composition shell. All interactive logic
 * (ticket / notes / status edits, linkage set/clear, soft-cancel delete, pickup
 * toggle) lives in {@link useRepairDetailsPanel}; the status / info / linkage
 * sections are presentational components under `./details-panel/`.
 */

import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Clock, Pencil } from '../Icons';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { RepairPickupFlow } from '@/components/repair/RepairPickupFlow';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import DeleteButton from '@/components/ui/DeleteButton';
import type { RepairDetailsPanelProps } from './details-panel/repair-details-shared';
import { useRepairDetailsPanel } from './details-panel/useRepairDetailsPanel';
import { RepairStatusSection } from './details-panel/RepairStatusSection';
import { RepairInfoSections } from './details-panel/RepairInfoSections';
import { RepairLinkageSection } from './details-panel/RepairLinkageSection';

export function RepairDetailsPanel({
  repair,
  onClose,
  onUpdate,
  onMoveUp = () => {},
  onMoveDown = () => {},
  disableMoveUp = false,
  disableMoveDown = false,
}: RepairDetailsPanelProps) {
  const c = useRepairDetailsPanel({ repair, onUpdate });

  return (
    <>
      <SlideOverBackdrop onClose={onClose} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 120 }}
        className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-2xl z-panel flex flex-col overflow-hidden"
      >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            {c.isEditingTicket ? (
              <input
                ref={c.ticketInputRef}
                type="text"
                value={c.ticketNumber}
                onChange={(e) => c.setTicketNumber(e.target.value)}
                onBlur={c.handleSaveTicket}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') {
                    c.setTicketNumber(repair.ticket_number || '');
                    c.setIsEditingTicket(false);
                  }
                }}
                className="text-xl font-black text-gray-900 tracking-tight leading-none w-full border-none focus:ring-0 p-0 bg-transparent uppercase"
                placeholder="TK Number"
                disabled={c.isSavingTicket}
              />
            ) : c.zendeskTicketUrl ? (
              <a
                href={c.zendeskTicketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xl font-black text-gray-900 tracking-tight leading-none uppercase hover:text-blue-600 transition-colors truncate"
                title={`Open Zendesk ticket ${c.ticketNumber}`}
              >
                {c.ticketNumber}
              </a>
            ) : (
              <p className="text-xl font-black text-gray-400 tracking-tight leading-none uppercase">
                TK Number
              </p>
            )}
            <p className="text-micro font-bold text-orange-600 uppercase tracking-widest mt-1">
              {c.isSavingTicket ? 'Saving...' : 'Repair In-Progress'}
            </p>
          </div>
          <button
            onClick={() => c.setIsEditingTicket(true)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-all shrink-0"
            aria-label="Edit ticket number"
            disabled={c.isSavingTicket}
          >
            <Pencil className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      <PanelActionBar
        onClose={onClose}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        disableMoveUp={disableMoveUp}
        disableMoveDown={disableMoveDown}
        actions={c.panelActions}
      />

      {/* Content sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <RepairStatusSection repair={repair} c={c} />
        <RepairInfoSections repair={repair} />
        <RepairLinkageSection c={c} />

        {/* Editable Notes */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Notes
          </h3>
          <textarea
            value={c.notes}
            onChange={(e) => c.setNotes(e.target.value)}
            onBlur={c.handleSaveNotes}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
            rows={4}
            placeholder="Add notes about this repair..."
            disabled={c.isSaving}
          />
          {c.isSaving && (
            <p className="text-xs text-gray-500 mt-2">Saving...</p>
          )}
        </section>

        {/* Danger zone — soft-cancel (delete) this repair via shared DeleteButton. */}
        <section className="border-t border-gray-200 pt-4">
          <DeleteButton
            onConfirm={c.handleDelete}
            onDeleted={onClose}
            label="Delete Repair"
            armedLabel="Click again to confirm"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm font-black uppercase tracking-wider transition-all hover:bg-rose-100 hover:border-rose-300 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </section>
      </div>

      {c.isMounted && c.showPickupFlow
        ? createPortal(
            <RepairPickupFlow
              repair={repair}
              onUpdate={onUpdate}
              onClose={() => c.setShowPickupFlow(false)}
            />,
            document.body,
          )
        : null}
      </motion.div>
    </>
  );
}
