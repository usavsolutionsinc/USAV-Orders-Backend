'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Clock, Package, Copy, Box, Wrench } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { PhotoGallery } from './PhotoGallery';
import { getStaffName } from '@/utils/staff';
import { getTrackingUrl, getAccountSourceLabel } from '@/utils/order-links';
import { buildShippedCopyInfo } from '@/utils/copyallshipped';
import { formatDateTimePST } from '@/utils/date';
import { CopyableValueFieldBlock } from '@/components/shipped/details-panel/blocks/CopyableValueFieldBlock';
import { OrderIdFieldBlock } from '@/components/shipped/details-panel/blocks/OrderIdFieldBlock';
import { SerialNumberFieldBlock } from '@/components/shipped/details-panel/blocks/SerialNumberFieldBlock';

interface ShippedDetailsPanelProps {
  shipped: ShippedOrder;
  onClose: () => void;
  onUpdate: () => void;
}

interface DurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

export function ShippedDetailsPanel({ 
  shipped: initialShipped, 
  onClose, 
  onUpdate 
}: ShippedDetailsPanelProps) {
  const [shipped, setShipped] = useState<ShippedOrder>(initialShipped);
  const [durationData] = useState<DurationData>({});
  const [copiedAll, setCopiedAll] = useState(false);

  // Update content when props change
  useEffect(() => {
    setShipped(initialShipped);
  }, [initialShipped]);

  const handleCopyAll = () => {
    const allInfo = buildShippedCopyInfo(shipped);
    navigator.clipboard.writeText(allInfo);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const accountSourceLabel = getAccountSourceLabel(shipped.order_id, shipped.account_source);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
      className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[100] overflow-y-auto no-scrollbar"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                    <Package className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-[22px] font-black text-gray-900 tracking-tighter leading-none">{shipped.order_id}</h2>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Verified Shipment</p>
                  </div>
                </div>
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

      
      {/* Content sections */}
      <div className="px-8 pb-8 pt-4 space-y-10">
        {/* Packer Photos Section - Enhanced Gallery */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
                Packing Photos
              </h3>
            </div>
          </div>
          
          <PhotoGallery 
            photos={shipped.packer_photos_url || []} 
            orderId={shipped.order_id}
          />
        </section>

        {/* Shipping Information */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                <Package className="w-4 h-4" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
                Shipping Information
              </h3>
            </div>
            <button
              onClick={handleCopyAll}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all hover:shadow-md active:scale-95"
              aria-label="Copy all shipping information"
            >
              {copiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Copy</span>
                </>
              )}
            </button>
          </div>
          
          <div className="space-y-4">
            <CopyableValueFieldBlock
              label="Tracking Number" 
              value={shipped.shipping_tracking_number || 'Not available'} 
              externalUrl={getTrackingUrl(shipped.shipping_tracking_number || '')}
              externalLabel="Open shipment tracking in new tab"
            />

            <OrderIdFieldBlock orderId={shipped.order_id} accountSourceLabel={accountSourceLabel} />

            <SerialNumberFieldBlock
              rowId={shipped.id}
              trackingNumber={shipped.shipping_tracking_number}
              serialNumber={shipped.serial_number}
              techId={shipped.tested_by ?? shipped.tester_id ?? null}
              onUpdate={onUpdate}
              onSerialNumberChange={(nextSerialNumber) => {
                setShipped((current) => ({
                  ...current,
                  serial_number: nextSerialNumber,
                }));
              }}
            />
          </div>
        </section>

        {/* Product Details */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
              <Box className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
              Product Details
            </h3>
          </div>

          <div className="space-y-4 bg-gray-50/50 rounded-[2rem] p-6 border border-gray-100">
            <div>
              <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-2">Product Title</span>
              <p className="font-bold text-sm text-gray-900 leading-relaxed truncate" title={shipped.product_title}>
                {shipped.product_title || 'Not provided'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1">Condition</span>
                <p className="font-black text-xs text-blue-600 uppercase">{shipped.condition || 'Not set'}</p>
              </div>
              <div>
                <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1">SKU</span>
                <p className="font-mono text-xs text-gray-900 font-bold">{shipped.sku || 'N/A'}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Packing Information */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
              <Box className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
              Packing Information
            </h3>
          </div>

          <div className="space-y-4 bg-orange-50/30 rounded-[2rem] p-6 border border-orange-100">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Packed By</span>
                <p className="font-black text-sm text-gray-900">{getStaffName(shipped.packed_by)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-orange-600">{durationData.boxingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-orange-100/50">
              <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {shipped.pack_date_time && shipped.pack_date_time !== '1' ? formatDateTimePST(shipped.pack_date_time) : 'N/A'}
              </p>
            </div>
          </div>
        </section>

        {/* Testing Information */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <Wrench className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
              Testing Information
            </h3>
          </div>

          <div className="space-y-4 bg-purple-50/30 rounded-[2rem] p-6 border border-purple-100">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Tested By</span>
                <p className="font-black text-sm text-gray-900">{getStaffName(shipped.tested_by)}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-purple-600">{durationData.testingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-purple-100/50">
              <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {shipped.test_date_time && shipped.test_date_time !== '' ? formatDateTimePST(shipped.test_date_time) : 'N/A'}
              </p>
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}
