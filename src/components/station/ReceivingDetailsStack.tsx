'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, Trash2, X } from '@/components/Icons';
import { formatDateTimePST } from '@/lib/timezone';

export interface ReceivingDetailsLog {
  id: string;
  timestamp: string;
  tracking?: string;
  status?: string;
  count?: number;
}

interface ReceivingDetailsStackProps {
  log: ReceivingDetailsLog;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

const CARRIER_OPTIONS = ['Unknown', 'UPS', 'FedEx', 'USPS', 'AMAZON', 'DHL', 'AliExpress', 'GoFo', 'UniUni'] as const;

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
  if (normalized === 'UNKNOWN') return 'Unknown';

  // Preserve unexpected values from DB so they remain viewable/editable.
  return raw;
}

export function ReceivingDetailsStack({ log, onClose, onUpdated, onDeleted }: ReceivingDetailsStackProps) {
  const [tracking, setTracking] = useState(log.tracking || '');
  const [carrier, setCarrier] = useState(normalizeCarrierValue(log.status));
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const deleteArmTimeoutRef = useRef<number | null>(null);
  const saveDebounceRef = useRef<number | null>(null);
  const initialSyncRef = useRef(true);

  useEffect(() => {
    setTracking(log.tracking || '');
    setCarrier(normalizeCarrierValue(log.status));
    setSaveMessage('idle');
    initialSyncRef.current = true;
  }, [log]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    if (!tracking.trim()) return;
    setIsSaving(true);
    setSaveMessage('saving');
    try {
      const res = await fetch('/api/receiving-logs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: Number(log.id),
          tracking: tracking.trim(),
          status: normalizeCarrierValue(carrier),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to update receiving log');
      }
      setSaveMessage('saved');
      onUpdated();
    } catch (error) {
      console.error('Failed to update receiving log:', error);
      setSaveMessage('error');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (initialSyncRef.current) {
      initialSyncRef.current = false;
      return;
    }
    if (!tracking.trim()) return;

    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current);
    }
    saveDebounceRef.current = window.setTimeout(() => {
      handleSave();
    }, 450);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, carrier]);

  const handleDelete = async () => {
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      if (deleteArmTimeoutRef.current) {
        window.clearTimeout(deleteArmTimeoutRef.current);
      }
      deleteArmTimeoutRef.current = window.setTimeout(() => {
        setIsDeleteArmed(false);
      }, 3000);
      return;
    }

    if (deleteArmTimeoutRef.current) {
      window.clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setIsDeleteArmed(false);

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/receiving-logs?id=${encodeURIComponent(log.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete receiving log');
      }
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
      className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[100] overflow-y-auto no-scrollbar"
    >
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-8 py-5 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="text-[20px] font-black text-gray-900 tracking-tight leading-none">Receiving #{log.id}</p>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">
              {formatDateTimePST(log.timestamp)}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-3 hover:bg-gray-50 rounded-2xl transition-all border border-transparent hover:border-gray-100"
          aria-label="Close details"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
      </div>

      <div className="px-8 py-6 min-h-[calc(100vh-96px)] flex flex-col">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Tracking Number</label>
            <input
              type="text"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-mono font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Carrier</label>
            <select
              value={carrier}
              onChange={(e) => setCarrier(normalizeCarrierValue(e.target.value))}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
            >
              {!CARRIER_OPTIONS.includes(carrier as any) && (
                <option value={carrier}>{carrier}</option>
              )}
              {CARRIER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-auto pt-8 space-y-2">
          <div className="h-5 text-center">
            {saveMessage === 'saving' && (
              <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">Saving...</p>
            )}
            {saveMessage === 'saved' && !isSaving && (
              <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Saved</p>
            )}
            {saveMessage === 'error' && !isSaving && (
              <p className="text-[10px] font-black uppercase tracking-wider text-red-600">Save Failed</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? 'Deleting...' : isDeleteArmed ? 'Click Again To Confirm' : 'Delete Row'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
