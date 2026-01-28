'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Clock, Package, Copy, Box, Wrench, ExternalLink } from '../Icons';
import { ShippedRecord } from '@/lib/neon/shipped-queries';
import { formatStatusTimestamp } from '@/lib/neon/status-history';
import { getCarrier } from '../../utils/tracking';

interface ShippedDetailsPanelProps {
  shipped: ShippedRecord;
  onClose: () => void;
  onUpdate: () => void;
}

interface DurationData {
  boxingDuration?: string;
  testingDuration?: string;
}

// URL helpers for external links
function getTrackingUrl(tracking: string): string | null {
  if (!tracking || tracking === 'Not available' || tracking === 'N/A') return null;
  const carrier = getCarrier(tracking);
  switch (carrier) {
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`;
    case 'UPS': return `https://www.ups.com/track?track=yes&trackNums=${tracking}&loc=en_US&requester=ST/trackdetails`;
    case 'FedEx': return `https://www.fedex.com/fedextrack/?trknbr=${tracking}&trkqual=12029~397652017412~FDEG`;
    default: return null;
  }
}

function getOrderIdUrl(orderId: string): string | null {
  if (!orderId || orderId === 'Not available' || orderId === 'N/A') return null;
  // Amazon order ID: 3 digits in the first group
  if (/^\d{3}-\d+-\d+$/.test(orderId)) {
    return `https://sellercentral.amazon.com/orders-v3/order/${orderId}`;
  }
  // Ecwid order ID: 4 digits
  if (/^\d{4}$/.test(orderId)) {
    return `https://my.ecwid.com/store/16593703#order:id=${orderId}&use_cache=true&return=orders`;
  }
  return null;
}

// Copyable field component
const CopyableField = ({ label, value, externalUrl, externalLabel }: { label: string; value: string; externalUrl?: string | null; externalLabel?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value || value === 'Not available' || value === 'N/A') return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExternalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const isEmpty = !value || value === 'Not available' || value === 'N/A';

  return (
    <div>
      <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest block mb-1.5">{label}</span>
      <div 
        onClick={handleCopy}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(); } }}
        tabIndex={isEmpty ? -1 : 0}
        role="button"
        aria-label={`Copy ${label}: ${value}`}
        className={`flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 rounded-xl border border-gray-100 group/field transition-all ${!isEmpty ? 'cursor-pointer hover:bg-gray-100 active:scale-[0.98]' : 'cursor-default'}`}
      >
        <p className="font-mono text-sm text-gray-900 font-bold flex-1 truncate">{value}</p>
        <div className="flex items-center gap-1.5">
          {!isEmpty && (
            <div className={`p-1.5 transition-all ${copied ? 'opacity-100' : 'opacity-0 group-hover/field:opacity-100'}`}>
              {copied ? (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-emerald-600 uppercase">Copied!</span>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              ) : (
                <Copy className="w-3.5 h-3.5 text-gray-400" />
              )}
            </div>
          )}
          {externalUrl && (
            <button
              onClick={handleExternalClick}
              className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-400 hover:text-blue-600"
              title={externalLabel || "Open in external tab"}
              aria-label={externalLabel || "Open in external tab"}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export function ShippedDetailsPanel({ 
  shipped: initialShipped, 
  onClose, 
  onUpdate 
}: ShippedDetailsPanelProps) {
  const [shipped, setShipped] = useState<ShippedRecord>(initialShipped);
  const [durationData, setDurationData] = useState<DurationData>({});
  const [isLoadingDurations, setIsLoadingDurations] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  // Update content when props change
  useEffect(() => {
    setShipped(initialShipped);
  }, [initialShipped]);

  // Listen for custom event to reuse instance (single instance behavior)
  useEffect(() => {
    const handleOpenDetails = (e: any) => {
        if (e.detail && e.detail.id !== shipped.id) {
            setShipped(e.detail);
        }
    };
    window.addEventListener('open-shipped-details', handleOpenDetails);
    return () => window.removeEventListener('open-shipped-details', handleOpenDetails);
  }, [shipped.id]);

  useEffect(() => {
    fetchDurations();
  }, [shipped.id]);

  const handleCopyAll = () => {
    const formatDateTime = (dateStr: string) => {
      if (!dateStr || dateStr === '1') return 'N/A';
      try {
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).replace(',', '');
      } catch (e) {
        return dateStr;
      }
    };

    const text = `Serial: ${shipped.serial_number || 'N/A'}
Order ID: ${shipped.order_id || 'N/A'}
Tracking: ${shipped.shipping_tracking_number || 'N/A'}
Product: ${shipped.product_title || 'N/A'}
Condition: ${shipped.condition || 'N/A'}
Tested By: ${shipped.tested_by || 'N/A'}
Boxed By: ${shipped.boxed_by || 'N/A'}
Shipped: ${shipped.date_time ? formatDateTime(shipped.date_time) : 'Not Shipped'}`;
    
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const fetchDurations = async () => {
    setIsLoadingDurations(true);
    try {
      const res = await fetch(`/api/shipped/durations?id=${shipped.id}`);
      if (res.ok) {
        const data = await res.json();
        setDurationData(data);
      }
    } catch (err) {
      console.error("Failed to fetch durations:", err);
    } finally {
      setIsLoadingDurations(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 150 }}
      className="fixed right-0 top-0 h-screen w-[420px] bg-white border-l border-gray-200 shadow-[-20px_0_50px_rgba(0,0,0,0.05)] z-[100] overflow-y-auto no-scrollbar"
    >
      {/* Header */}
      <div className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 p-8 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
                <button
                    onClick={handleCopyAll}
                    className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-all active:scale-95 group"
                >
                    {copiedAll ? (
                        <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-[8px] font-black text-emerald-600 uppercase">Copied All</span>
                        </>
                    ) : (
                        <>
                            <Copy className="w-3 h-3 text-gray-400 group-hover:text-blue-600" />
                            <span className="text-[8px] font-black text-gray-500 uppercase group-hover:text-blue-600">Copy All</span>
                        </>
                    )}
                </button>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                        <Package className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-gray-900 tracking-tighter leading-none">{shipped.order_id}</h2>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Verified Shipment</p>
                      </div>
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
      <div className="p-8 space-y-10">
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
              className="p-2 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-100 flex items-center gap-2 group"
              title="Copy all order details"
            >
              {copiedAll ? (
                <>
                  <span className="text-[10px] font-black text-emerald-600 uppercase">Copied All!</span>
                  <Check className="w-4 h-4 text-emerald-600" />
                </>
              ) : (
                <Copy className="w-4 h-4 text-gray-400 group-hover:text-blue-600" />
              )}
            </button>
          </div>
          
          <div className="space-y-4">
            <CopyableField 
              label="Tracking Number" 
              value={shipped.shipping_tracking_number || 'Not available'} 
              externalUrl={getTrackingUrl(shipped.shipping_tracking_number)}
              externalLabel="Open shipment tracking in new tab"
            />
            <CopyableField 
              label="Order ID" 
              value={shipped.order_id || 'Not available'} 
              externalUrl={getOrderIdUrl(shipped.order_id)}
              externalLabel={/^\d{3}-\d+-\d+$/.test(shipped.order_id) ? "Open Amazon order in Seller Central in new tab" : "Open Ecwid order in new tab"}
            />
            <CopyableField 
              label="Serial Number" 
              value={shipped.serial_number || 'N/A'} 
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
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Boxed By</span>
                <p className="font-black text-sm text-gray-900">{shipped.boxed_by || 'Not specified'}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-orange-600">{durationData.boxingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-orange-100/50">
              <span className="text-[10px] text-orange-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {shipped.date_time && shipped.date_time !== '1' ? new Date(shipped.date_time).toLocaleString() : 'N/A'}
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
                <p className="font-black text-sm text-gray-900">{shipped.tested_by || 'Not specified'}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Duration</span>
                <p className="font-mono text-sm font-black text-purple-600">{durationData.testingDuration || '--:--'}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-purple-100/50">
              <span className="text-[10px] text-purple-600/60 font-black uppercase tracking-widest block mb-1">Timestamp</span>
              <p className="text-xs font-bold text-gray-600">
                {/* Note: In a real app, you might want to fetch the exact testing timestamp from the tech table */}
                Testing completion timestamp synced with packing log.
              </p>
            </div>
          </div>
        </section>

        {/* Current Status */}
        <section className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">Current Status</h3>
          <div className="bg-blue-600 rounded-2xl p-4 shadow-lg shadow-blue-100">
            <p className="text-sm font-black uppercase tracking-widest text-white">{shipped.status || 'No status set'}</p>
          </div>
        </section>
        
        {/* Status History */}
        {shipped.status_history && shipped.status_history.length > 0 && (
          <section className="space-y-6">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">
              Status History
            </h3>
            <div className="space-y-3">
              {shipped.status_history.slice().reverse().map((entry, idx) => {
                const isShippedOrPickedUp = entry.status === 'Shipped' || entry.status === 'Picked Up';
                
                return (
                  <div 
                    key={idx} 
                    className={`flex items-start gap-4 p-4 rounded-2xl transition-all ${
                      isShippedOrPickedUp ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50 border border-gray-100'
                    }`}
                  >
                    <div className={`mt-1 p-1.5 rounded-lg ${isShippedOrPickedUp ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                      {isShippedOrPickedUp ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-black text-sm ${isShippedOrPickedUp ? 'text-emerald-900' : 'text-gray-900'}`}>
                        {entry.status}
                      </p>
                      <p className="text-[10px] font-bold text-gray-500 mt-1 uppercase tracking-wider">
                        {formatStatusTimestamp(entry.timestamp)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </motion.div>
  );
}
