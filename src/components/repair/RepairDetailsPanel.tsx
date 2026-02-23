'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Clock, Pencil } from '../Icons';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { formatStatusTimestamp } from '@/lib/neon/status-history';

interface RepairDetailsPanelProps {
  repair: RSRecord;
  onClose: () => void;
  onUpdate: () => void;
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
  onUpdate 
}: RepairDetailsPanelProps) {
  const [notes, setNotes] = useState(repair.notes || '');
  const [ticketNumber, setTicketNumber] = useState(repair.ticket_number || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingTicket, setIsSavingTicket] = useState(false);
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const ticketInputRef = useRef<HTMLInputElement>(null);

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
      // Revert on error
      setTicketNumber(repair.ticket_number || '');
    } finally {
      setIsSavingTicket(false);
      setIsEditingTicket(false);
    }
  };

  const zendeskTicketUrl = ticketNumber.trim()
    ? `https://usav.zendesk.com/agent/tickets/${encodeURIComponent(ticketNumber.trim())}`
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
      // Revert on error
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
      className="fixed right-0 top-0 h-screen w-[400px] bg-white border-l border-gray-200 shadow-2xl z-[100] overflow-y-auto"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-gray-200 p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
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
              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mt-1">
                {isSavingTicket ? 'Saving...' : 'Repair In-Progress'}
              </p>
            </div>
            <button
              onClick={() => setIsEditingTicket(true)}
              className="p-2 hover:bg-gray-100 rounded-xl transition-all"
              aria-label="Edit ticket number"
              disabled={isSavingTicket}
            >
              <Pencil className="w-4 h-4 text-gray-600" />
            </button>
        </div>
        <button 
          onClick={onClose} 
          className="p-2 hover:bg-gray-100 rounded-xl transition-all ml-2"
          aria-label="Close details"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>
      
      {/* Content sections */}
      <div className="p-6 space-y-6">
        {/* Current Status - Moved to Top */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
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
        </section>

        {/* Customer Information */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
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
                  
                  // Format phone number
                  const formatPhoneNumber = (phone: string): string => {
                    if (!phone) return '';
                    const cleaned = phone.replace(/\D/g, '');
                    if (cleaned.length === 10) {
                      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
                    }
                    return phone;
                  };
                  
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
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
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
        
        {/* Status History */}
        {repair.status_history && repair.status_history.length > 0 && (
          <section>
            <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
              Status History
            </h3>
            <div className="space-y-2">
              {repair.status_history.slice().reverse().map((entry, idx) => {
                const isDone = entry.status === 'Done';
                
                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      isDone ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50'
                    }`}
                  >
                    <div className={`mt-0.5 ${isDone ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {isDone ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${isDone ? 'text-emerald-900' : 'text-gray-900'}`}>
                        {entry.status}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        {formatStatusTimestamp(entry.timestamp)}
                      </p>
                      {entry.previous_status && (
                        <p className="text-[10px] text-gray-500 mt-1">
                          From: {entry.previous_status}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        
        {/* Editable Notes */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
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
    </motion.div>
  );
}
