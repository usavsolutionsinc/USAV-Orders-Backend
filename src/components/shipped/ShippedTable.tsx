'use client';

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, X } from '../Icons';
import { CopyableText } from '../ui/CopyableText';
import { ShippedRecord } from '@/lib/neon/shipped-queries';
import { ShippedDetailsPanel } from './ShippedDetailsPanel';

const STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Awaiting Additional Parts Payment',
  'Shipped',
  'Picked Up'
];

export function ShippedTable() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [shipped, setShipped] = useState<ShippedRecord[]>([]);
  const [selectedShipped, setSelectedShipped] = useState<ShippedRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);

  useEffect(() => {
    fetchShipped();
  }, [search]);

  const fetchShipped = async () => {
    try {
      setLoading(true);
      const url = search 
        ? `/api/shipped/search?q=${encodeURIComponent(search)}`
        : '/api/shipped';
      const res = await fetch(url);
      const data = await res.json();
      
      if (search) {
        setShipped(data.results || []);
      } else {
        setShipped(data.shipped || []);
      }
    } catch (error) {
      console.error('Error fetching shipped records:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatHeaderDate = () => {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const monthName = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
    const day = now.getDate();
    
    // Ordinal suffix
    let suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';
    
    return `${dayName}, ${monthName} ${day}${suffix}`;
  };

  const handleStatusChange = async (id: number, newStatus: string) => {
    // Optimistic update
    setShipped(prev => prev.map(s => 
      s.id === id ? { ...s, status: newStatus } : s
    ));
    
    setUpdatingStatus(id);
    
    try {
      const res = await fetch('/api/shipped', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      // Refresh to get updated status history
      await fetchShipped();
    } catch (error) {
      console.error('Error updating status:', error);
      // Rollback on error
      fetchShipped();
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleRowClick = (record: ShippedRecord) => {
    setSelectedShipped(record);
  };

  const handleCloseDetails = () => {
    setSelectedShipped(null);
  };

  const handleUpdate = () => {
    fetchShipped();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading shipped records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-gray-50">
      {/* Main table container */}
      <div className={`flex-1 overflow-auto transition-all duration-300 ${
        selectedShipped ? 'mr-[400px]' : ''
      }`}>
        {/* Sticky header */}
        <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-6 py-3 shadow-sm">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-black text-gray-900 tracking-widest uppercase">
              {formatHeaderDate()}
            </h1>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Count:</span>
              <span className="text-sm font-black text-blue-600">{shipped.length}</span>
            </div>
            {search && (
              <>
                <div className="h-4 w-px bg-gray-200" />
                <div className="flex items-center gap-2 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
                  <Search className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">{search}</span>
                  <button 
                    onClick={() => window.history.pushState({}, '', '/shipped')}
                    className="hover:text-blue-900 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Table */}
        <div className="bg-white">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-[73px] z-[5] hidden">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  Date/Time
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 sr-only">
                  Order ID
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  Product Title
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  Sent
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 sr-only">
                  Shipping TRK #
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 sr-only">
                  Serial #
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  Boxed
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  By
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  SKU
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-gray-600 whitespace-nowrap">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shipped.map(record => (
                <motion.tr 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={record.id}
                  onClick={() => handleRowClick(record)}
                  className={`group hover:bg-blue-50/80 cursor-pointer transition-all duration-200 ${
                    selectedShipped?.id === record.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''
                  }`}
                >
                  {/* Date/Time */}
                  <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                    {record.date_time ? new Date(record.date_time).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }) : '---'}
                  </td>
                  
                  {/* Order ID - Copyable */}
                  <td className="px-4 py-3 text-sm font-mono">
                    <CopyableText text={record.order_id || '---'} />
                  </td>
                  
                  {/* Product Title */}
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <div className="max-w-[250px] truncate" title={record.product_title}>
                      {record.product_title || '---'}
                    </div>
                  </td>
                  
                  {/* Sent */}
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {record.sent || '---'}
                  </td>
                  
                  {/* Shipping TRK # - Copyable */}
                  <td className="px-4 py-3 text-sm font-mono">
                    <CopyableText text={record.shipping_trk_number || '---'} />
                  </td>
                  
                  {/* Serial # - Copyable */}
                  <td className="px-4 py-3 text-sm font-mono">
                    <CopyableText text={record.serial_number || '---'} />
                  </td>
                  
                  {/* Boxed */}
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {record.boxed || '---'}
                  </td>
                  
                  {/* By */}
                  <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                    {record.by || '---'}
                  </td>
                  
                  {/* SKU */}
                  <td className="px-4 py-3 text-sm font-mono text-gray-900 whitespace-nowrap">
                    {record.sku || '---'}
                  </td>
                  
                  {/* Status Dropdown */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={record.status || ''}
                      onChange={(e) => handleStatusChange(record.id, e.target.value)}
                      disabled={updatingStatus === record.id}
                      className="text-xs font-bold px-2 py-1 rounded-lg border border-gray-200 bg-white hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">Select status...</option>
                      {STATUS_OPTIONS.map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </motion.tr>
              ))}
              
              {shipped.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-24 text-center">
                    {search ? (
                      <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Search className="w-8 h-8 text-red-400" />
                        </div>
                        <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Order not found</h3>
                        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                          We couldn't find any records matching "{search}"
                        </p>
                        <button 
                          onClick={() => window.history.pushState({}, '', '/shipped')}
                          className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                        >
                          Show All Orders
                        </button>
                      </div>
                    ) : (
                      <p className="text-gray-500 font-medium italic">No shipped records found</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Details Panel */}
      <AnimatePresence>
        {selectedShipped && (
          <ShippedDetailsPanel 
            shipped={selectedShipped}
            onClose={handleCloseDetails}
            onUpdate={handleUpdate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
