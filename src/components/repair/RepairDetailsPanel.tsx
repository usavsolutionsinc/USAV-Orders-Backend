'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Clock } from '../Icons';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { formatStatusTimestamp } from '@/lib/neon/status-history';

interface RepairDetailsPanelProps {
  repair: RSRecord;
  onClose: () => void;
  onUpdate: () => void;
}

export function RepairDetailsPanel({ 
  repair, 
  onClose, 
  onUpdate 
}: RepairDetailsPanelProps) {
  const [notes, setNotes] = useState(repair.notes || '');
  const [isSaving, setIsSaving] = useState(false);

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
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                <Clock className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 tracking-tight leading-none">{repair.ticket_number}</h2>
              <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mt-1">Repair In-Progress</p>
            </div>
        </div>
        <button 
          onClick={onClose} 
          className="p-2 hover:bg-gray-100 rounded-xl transition-all"
          aria-label="Close details"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>
      
      {/* Content sections */}
      <div className="p-6 space-y-6">
        {/* Customer Information */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Customer Information
          </h3>
          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Contact</span>
              <p className="font-semibold text-sm text-gray-900">{repair.contact || 'Not provided'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Product(s)</span>
              <p className="font-semibold text-sm text-gray-900">{repair.product_title || 'Not provided'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Price</span>
              <p className="font-bold text-sm text-gray-900">{repair.price ? `$${repair.price}` : 'Not set'}</p>
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
              <span className="text-xs text-gray-500 font-semibold block mb-1">Serial Number</span>
              <p className="font-mono text-sm text-gray-900 font-semibold">{repair.serial_number || 'N/A'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Issue Description</span>
              <p className="text-sm text-gray-700 leading-relaxed">{repair.issue || 'No issue described'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 font-semibold block mb-1">Process History</span>
              {repair.process && repair.process.length > 0 ? (
                <div className="space-y-2">
                  {repair.process.map((entry, idx) => (
                    <div key={idx} className="bg-gray-50 p-2 rounded text-xs">
                      <div className="font-semibold text-gray-900">Parts: {entry.parts}</div>
                      <div className="text-gray-600">By: {entry.person}</div>
                      <div className="text-gray-500">{new Date(entry.date).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-700 leading-relaxed">No process history</p>
              )}
            </div>
          </div>
        </section>

        {/* Current Status */}
        <section>
          <h3 className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-3 border-b border-gray-200 pb-2">
            Current Status
          </h3>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-black uppercase tracking-wider text-blue-900">{repair.status || 'No status set'}</p>
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
                const isShippedOrPickedUp = entry.status === 'Shipped' || entry.status === 'Picked Up';
                
                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-3 p-3 rounded-lg ${
                      isShippedOrPickedUp ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50'
                    }`}
                  >
                    <div className={`mt-0.5 ${isShippedOrPickedUp ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {isShippedOrPickedUp ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-bold text-sm ${isShippedOrPickedUp ? 'text-emerald-900' : 'text-gray-900'}`}>
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
