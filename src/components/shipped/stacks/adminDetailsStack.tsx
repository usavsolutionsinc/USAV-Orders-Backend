'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Package, X } from '@/components/Icons';
import { DashboardDetailsStack } from './dashboarddetailsStack';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';

interface StaffOption {
  id: number;
  name: string;
}

interface AdminOrder {
  id: number;
  ship_by_date: string | null;
  order_id: string;
  product_title: string;
  sku: string;
  shipping_tracking_number: string | null;
  tester_id: number | null;
  packer_id: number | null;
  out_of_stock: string | null;
  notes?: string | null;
  is_shipped: boolean;
  created_at: string | null;
}

interface AdminDetailsStackProps {
  order: AdminOrder | null;
  selectedCount: number;
  testerOptions: StaffOption[];
  packerOptions: StaffOption[];
  testerName?: string | null;
  packerName?: string | null;
  bulkTesterId: number | null;
  bulkPackerId: number | null;
  onBulkTesterChange: (value: number | null) => void;
  onBulkPackerChange: (value: number | null) => void;
  onApplyBulk: () => Promise<void> | void;
  isApplyingBulk: boolean;
  onClose: () => void;
  onOrderUpdated?: () => void;
}

export function AdminDetailsStack({
  order,
  selectedCount,
  testerOptions,
  packerOptions,
  bulkTesterId,
  bulkPackerId,
  onBulkTesterChange,
  onBulkPackerChange,
  onApplyBulk,
  isApplyingBulk,
  onClose,
  onOrderUpdated,
}: AdminDetailsStackProps) {
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopyAll = () => {
    if (!order) return;
    navigator.clipboard.writeText(buildShippedCopyInfo(order as any));
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
      className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[120] overflow-y-auto no-scrollbar"
    >
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-8 py-5 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-[20px] font-black text-gray-900 tracking-tight leading-none">Admin Details</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-gray-500">{selectedCount} selected</p>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-3 hover:bg-gray-50 rounded-2xl transition-all border border-transparent hover:border-gray-100"
          aria-label="Close panel"
        >
          <X className="w-6 h-6 text-gray-400" />
        </button>
      </div>

      <div className="px-6 py-5 space-y-4">
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Tester</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onBulkTesterChange(null)}
                className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                  bulkTesterId === null
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
              >
                No Change
              </button>
              {testerOptions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => onBulkTesterChange(member.id)}
                  className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                    bulkTesterId === member.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-500">Packer</label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onBulkPackerChange(null)}
                className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                  bulkPackerId === null
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
              >
                No Change
              </button>
              {packerOptions.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => onBulkPackerChange(member.id)}
                  className={`px-2.5 h-8 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                    bulkPackerId === member.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onApplyBulk}
            disabled={selectedCount === 0 || isApplyingBulk || (bulkTesterId === null && bulkPackerId === null)}
            className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            <Check className="w-3 h-3" />
            {isApplyingBulk ? 'Applying...' : 'Apply To Selected'}
          </button>
        </div>
      </div>

      {selectedCount <= 1 && order ? (
        <DashboardDetailsStack
          shipped={order as any}
          durationData={{}}
          copiedAll={copiedAll}
          onCopyAll={handleCopyAll}
          onUpdate={onOrderUpdated}
          mode="dashboard"
          showAssignmentButton={false}
        />
      ) : selectedCount <= 1 ? (
        <div className="px-6 pb-8">
          <div className="h-px bg-gray-100 mb-4" />
          <p className="text-xs font-semibold text-gray-500">Select an order to view details.</p>
        </div>
      ) : null}
    </motion.div>
  );
}
