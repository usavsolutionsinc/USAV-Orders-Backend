'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Barcode, Check, Clock, Pencil, Printer } from '../Icons';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { PanelActionBar } from '@/components/shipped/details-panel/PanelActionBar';
import { usePanelActions } from '@/hooks/usePanelActions';
import { formatPhoneNumber } from '@/utils/phone';
import { printRepairLabel } from '@/lib/print/printRepairLabel';
import { RepairPickupFlow } from '@/components/repair/RepairPickupFlow';

interface RepairDetailsPanelProps {
  repair: RSRecord;
  /** If coming from the queue, pass the current work_assignment id (null = unassigned) */
  assignmentId?: number | null;
  /** Current assigned tech id, if any */
  assignedTechId?: number | null;
  onClose: () => void;
  onUpdate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disableMoveUp?: boolean;
  disableMoveDown?: boolean;
}

const STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Done'
];

export function RepairDetailsPanel({ 
  repair, 
  onClose, 
  onUpdate,
  onMoveUp = () => {},
  onMoveDown = () => {},
  disableMoveUp = false,
  disableMoveDown = false,
}: RepairDetailsPanelProps) {
  const [notes, setNotes] = useState(repair.notes || '');
  const [ticketNumber, setTicketNumber] = useState(repair.ticket_number || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showPickupFlow, setShowPickupFlow] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const ticketInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const PICKUP_STATUSES = useMemo(
    () => new Set(['Repaired, Contact Customer', 'Awaiting Pickup', 'Awaiting Payment', 'Done']),
    [],
  );
  const canStartPickup = PICKUP_STATUSES.has((repair.status || '').trim());

  useEffect(() => {
    setNotes(repair.notes || '');
    setTicketNumber(repair.ticket_number || '');
    setIsEditingTicket(false);
    setIsSavingTicket(false);
  }, [repair.id, repair.notes, repair.ticket_number]);

  useEffect(() => {
    if (isEditingTicket && ticketInputRef.current) {
      ticketInputRef.current.focus();
      ticketInputRef.current.select();
    }
  }, [isEditingTicket]);

  const handleSaveTicket = async () => {
    if (ticketNumber === repair.ticket_number) {
      setIsEditingTicket(false);
      return;
    }
    
    setIsSavingTicket(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: repair.id, 
          field: 'ticket_number', 
          value: ticketNumber 
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to save ticket number');
      }

      onUpdate();
    } catch (error) {
      console.error('Error saving ticket number:', error);
      setTicketNumber(repair.ticket_number || '');
    } finally {
      setIsSavingTicket(false);
      setIsEditingTicket(false);
    }
  };

  const panelActions = usePanelActions(
    { entityType: 'repair', entityId: repair.id },
  );

  const zendeskTicketUrl = ticketNumber.trim()
    && !/^RS-\d+$/i.test(ticketNumber.trim())
    ? `https://usav.zendesk.com/agent/tickets/${encodeURIComponent(ticketNumber.trim().replace(/^#/, ''))}`
    : null;

  const handleSaveNotes = async () => {
    if (notes === repair.notes) return;
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: repair.id, notes }),
      });

      if (!res.ok) {
        throw new Error('Failed to save notes');
      }

      onUpdate();
    } catch (error) {
      console.error('Error saving notes:', error);
      setNotes(repair.notes || '');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: repair.id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      onUpdate();
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 120 }}
      className="fixed right-0 top-0 h-screen w-[400px] bg-white border-l border-gray-200 shadow-2xl z-[100] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditingTicket ? (
              <input
                ref={ticketInputRef}
                type="text"
                value={ticketNumber}
                onChange={(e) => setTicketNumber(e.target.value)}
                onBlur={handleSaveTicket}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') {
                    setTicketNumber(repair.ticket_number || '');
                    setIsEditingTicket(false);
                  }
                }}
                className="text-xl font-black text-gray-900 tracking-tight leading-none w-full border-none focus:ring-0 p-0 bg-transparent uppercase"
                placeholder="TK Number"
                disabled={isSavingTicket}
              />
            ) : zendeskTicketUrl ? (
              <a
                href={zendeskTicketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xl font-black text-gray-900 tracking-tight leading-none uppercase hover:text-blue-600 transition-colors truncate"
                title={`Open Zendesk ticket ${ticketNumber}`}
              >
                {ticketNumber}
              </a>
            ) : (
              <p className="text-xl font-black text-gray-400 tracking-tight leading-none uppercase">
                TK Number
              </p>
            )}
            <p className="text-micro font-bold text-orange-600 uppercase tracking-widest mt-1">
              {isSavingTicket ? 'Saving...' : 'Repair In-Progress'}
            </p>
          </div>
          <button
            onClick={() => setIsEditingTicket(true)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-all shrink-0"
            aria-label="Edit ticket number"
            disabled={isSavingTicket}
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
        actions={panelActions}
      />

      {/* Content sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Current Status */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Update Status
          </h3>
          <select
            value={repair.status || ''}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={updatingStatus}
            className={`w-full text-sm font-black uppercase tracking-wider px-4 py-3 rounded-lg border transition-all outline-none focus:ring-4 focus:ring-blue-500/10 ${
              repair.status === 'Done'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : repair.status?.includes('Awaiting')
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <option value="">Select Status...</option>
            {STATUS_OPTIONS.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const fullName = (repair.contact_info || '').split(',')[0]?.trim() || '';
                const firstName = fullName.split(/\s+/)[0] || 'Repair';
                const fmtDate = (d: Date) =>
                  d.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: '2-digit',
                  });
                const intake = repair.created_at ? new Date(repair.created_at) : new Date();
                const due = new Date(intake.getTime());
                // 10 calendar days — upper bound of the "3–10 working days" SLA on the receipt
                due.setDate(due.getDate() + 10);
                printRepairLabel({
                  repairId: repair.id,
                  rsCode: `RS-${repair.id}`,
                  firstName,
                  ticketNumber: repair.ticket_number || '',
                  date: fmtDate(new Date()),
                  dueDate: fmtDate(due),
                });
              }}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm font-black uppercase tracking-wider transition-all hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
              title="Print 2x1 product label"
              aria-label="Print product label"
            >
              <Barcode className="w-4 h-4 text-gray-700" />
              Label
            </button>
            <button
              type="button"
              onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank', 'noopener,noreferrer')}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm font-black uppercase tracking-wider transition-all hover:bg-gray-50 hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              title="Print repair service document"
              aria-label="Print repair service document"
            >
              <Printer className="w-4 h-4 text-gray-700" />
              Print
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowPickupFlow(true)}
            disabled={!canStartPickup}
            className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-black uppercase tracking-wider transition-all hover:bg-emerald-100 hover:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              canStartPickup
                ? 'Launch the customer pickup signature flow'
                : 'Available when the repair is ready for pickup'
            }
            aria-label="Start customer pickup signature"
          >
            <Check className="w-4 h-4" />
            Start Pickup
          </button>
        </section>

        {/* Customer Information */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Customer Information
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Name</span>
              <p className="font-bold text-sm text-gray-900">
                {(() => {
                  if (!repair.contact_info) return 'Not provided';
                  const parts = repair.contact_info.split(',').map(p => p.trim());
                  return parts[0] || 'Not provided';
                })()}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Contact</span>
              <div className="space-y-1">
                {(() => {
                  if (!repair.contact_info) return <p className="font-semibold text-sm text-gray-900">Not provided</p>;
                  const parts = repair.contact_info.split(',').map(p => p.trim());
                  const phone = parts[1] || '';
                  const email = parts[2] || '';
                  
                  return (
                    <>
                      {phone && <p className="font-semibold text-sm text-gray-900">{formatPhoneNumber(phone)}</p>}
                      {email && <p className="font-semibold text-sm text-gray-900 lowercase">{email}</p>}
                      {!phone && !email && <p className="font-semibold text-sm text-gray-900">{repair.contact_info}</p>}
                    </>
                  );
                })()}
              </div>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Product(s)</span>
              <p className="font-semibold text-sm text-gray-900">{repair.product_title || 'Not provided'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Price</span>
              <p className="font-bold text-sm text-emerald-600">{repair.price ? `$${repair.price}` : 'Not set'}</p>
            </div>
          </div>
        </section>
        
        {/* Technical Details */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Technical Details
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Issue</span>
              <p className="text-sm text-gray-900 font-bold leading-relaxed">{repair.issue || 'No issue described'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Serial Number</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{repair.serial_number || 'N/A'}</p>
            </div>
          </div>
        </section>
        
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Record
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Created</span>
              <p className="font-semibold text-sm text-gray-900">
                {repair.created_at ? new Date(repair.created_at).toLocaleString() : 'Unknown'}
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Updated</span>
              <p className="font-semibold text-sm text-gray-900">
                {repair.updated_at ? new Date(repair.updated_at).toLocaleString() : 'Unknown'}
              </p>
            </div>
          </div>
        </section>
        
        {/* Editable Notes */}
        <section>
          <h3 className="text-micro font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Notes
          </h3>
          <textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleSaveNotes}
            className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
            rows={4}
            placeholder="Add notes about this repair..."
            disabled={isSaving}
          />
          {isSaving && (
            <p className="text-xs text-gray-500 mt-2">Saving...</p>
          )}
        </section>
      </div>

      {isMounted && showPickupFlow
        ? createPortal(
            <RepairPickupFlow
              repair={repair}
              onUpdate={onUpdate}
              onClose={() => setShowPickupFlow(false)}
            />,
            document.body,
          )
        : null}
    </motion.div>
  );
}
