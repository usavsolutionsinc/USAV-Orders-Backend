'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  PackageCheck, 
  Search, 
  Bell, 
  Filter,
  Package,
  Clock,
  User,
  RefreshCw,
  Plus
} from '@/components/Icons';
import { 
  MobileCard, 
  MobilePageHeader, 
  TOKENS 
} from '@/components/mobile/redesign/DesignSystem';
import { useRouter } from 'next/navigation';

interface ReceivingItem {
  id: number;
  sku: string;
  itemName: string;
  qty: number;
  status: 'received' | 'pending' | 'priority';
  receivedAt: string;
  staff: string;
}

const MOCK_RECEIVING: ReceivingItem[] = [
  { id: 1, sku: 'SONY-WH1000XM5-B', itemName: 'Sony WH-1000XM5 Wireless Headphones (Black)', qty: 5, status: 'priority', receivedAt: '2m ago', staff: 'Michael T.' },
  { id: 2, sku: 'AAPL-AIRP-PRO2', itemName: 'Apple AirPods Pro (2nd Gen)', qty: 12, status: 'received', receivedAt: '15m ago', staff: 'Sarah J.' },
  { id: 3, sku: 'LOGI-MX-M3S', itemName: 'Logitech MX Master 3S Mouse', qty: 8, status: 'received', receivedAt: '1h ago', staff: 'Michael T.' },
  { id: 4, sku: 'DJI-MINI3-PRO', itemName: 'DJI Mini 3 Pro Drone', qty: 2, status: 'pending', receivedAt: 'In Transit', staff: '—' },
];

export default function RedesignedMobileReceivingLive() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} px-4 pb-32`}>
      {/* Top App Bar */}
      <div className="flex items-center justify-between py-4 px-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-slate-900 flex items-center justify-center text-white">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Inventory</p>
            <p className="text-sm font-bold text-slate-900">Receiving</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <Filter className="h-5 w-5" />
          </button>
          <button className="h-10 w-10 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600">
            <Search className="h-5 w-5" />
          </button>
        </div>
      </div>

      <MobilePageHeader 
        title="Receiving Live" 
        subtitle="Real-time inbound inventory stream"
      />

      {/* Tabs */}
      <div className="flex bg-slate-100 rounded-2xl p-1 mb-6">
        <button 
          onClick={() => setActiveTab('live')}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'live' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
        >
          Live Feed
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
        >
          History
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {MOCK_RECEIVING.map((item) => (
          <motion.div key={item.id} layout>
            <MobileCard className="relative">
              {item.status === 'priority' && (
                <div className="absolute top-0 right-0 px-3 py-1 bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-bl-xl rounded-tr-2xl">
                  Priority
                </div>
              )}
              
              <div className="flex gap-4">
                <div className="h-14 w-14 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Package className="h-7 w-7 text-slate-300" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-blue-600 font-mono">{item.sku}</p>
                  <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{item.itemName}</p>
                  
                  <div className="mt-3 flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-black uppercase text-slate-500">{item.qty} Received</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-[10px] font-black uppercase text-slate-400">{item.receivedAt}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-slate-200 border border-white" />
                  <span className="text-xs font-bold text-slate-600">{item.staff}</span>
                </div>
                <button className="text-xs font-bold text-blue-600">Details →</button>
              </div>
            </MobileCard>
          </motion.div>
        ))}
      </div>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => router.push('/m/receive')}
        className="fixed bottom-24 right-6 h-14 w-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center z-40"
      >
        <Plus className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
