'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShoppingCart, 
  Search, 
  ChevronRight,
  Package,
  Clock,
  User,
  RefreshCw,
  LayoutGrid,
  Filter
} from '@/components/Icons';
import { 
  MobileCard, 
  MobilePageHeader, 
  TOKENS,
  SectionHeader
} from '@/components/mobile/redesign/DesignSystem';
import { useRouter } from 'next/navigation';

interface QueueItem {
  id: number;
  label: string;
  initials: string;
  customer: string;
  units: number;
  status: 'pending' | 'picking' | 'overdue';
  due: string;
  source: string;
  color: string;
}

const MOCK_QUEUE: QueueItem[] = [
  { id: 1024, label: '#1024', initials: 'JD', customer: 'John Doe', units: 3, status: 'overdue', due: '2h ago', source: 'eBay', color: 'rose' },
  { id: 1025, label: '#1025', initials: 'MS', customer: 'Mary Smith', units: 1, status: 'picking', due: 'in 4h', source: 'Amazon', color: 'amber' },
  { id: 1026, label: '#1026', initials: 'BK', customer: 'Bob Knight', units: 5, status: 'pending', due: 'in 8h', source: 'Website', color: 'blue' },
  { id: 1027, label: '#1027', initials: 'AL', customer: 'Alice Lee', units: 2, status: 'pending', due: 'Tomorrow', source: 'eBay', color: 'slate' },
];

export default function RedesignedMobilePickQueue() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} px-4 pb-12 pt-2`}>
      {/* Top App Bar with Close/Back */}
      <div className="flex items-center justify-between py-2 px-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] text-blue-400 font-black uppercase tracking-widest">Operations</p>
            <p className="text-sm font-black text-blue-950">Pick Queue</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleRefresh}
            className={`h-10 w-10 rounded-full bg-white border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm active:scale-90 transition-all ${refreshing ? 'animate-spin' : ''}`}
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <button 
            onClick={() => router.back()}
            className="h-10 w-10 rounded-full bg-white border border-blue-100 flex items-center justify-center text-blue-400 shadow-sm active:scale-90 transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <MobilePageHeader 
        title="Active Picks" 
        subtitle={`${MOCK_QUEUE.length} orders waiting for fulfillment`}
      />

      <SectionHeader title="Priority Queue" />

      <div className="flex flex-col gap-3.5 mt-2">
        <AnimatePresence>
          {MOCK_QUEUE.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => router.push(`/m/pick/${item.id}`)}
            >
              <MobileCard className="relative overflow-hidden group border-l-0">
                {/* Status Indicator Bar */}
                <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                  item.status === 'overdue' ? 'bg-rose-500' : 
                  item.status === 'picking' ? 'bg-amber-500' : 'bg-blue-600'
                }`} />

                <div className="flex items-center gap-4">
                  <div className={`h-14 w-14 rounded-2xl flex items-center justify-center font-black text-lg shadow-sm border ${
                    item.status === 'overdue' ? 'bg-rose-50 border-rose-100 text-rose-600' : 
                    item.status === 'picking' ? 'bg-amber-50 border-amber-100 text-amber-600' :
                    'bg-blue-50 border-blue-100 text-blue-600'
                  }`}>
                    {item.initials}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-base font-black text-blue-950 tracking-tight">{item.label}</p>
                      <span className="text-[9px] font-black uppercase tracking-[0.1em] bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full border border-blue-100/50">
                        {item.source}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-blue-700/60 truncate">{item.customer}</p>
                  </div>

                  <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-active:bg-blue-100 transition-colors shrink-0">
                    <ChevronRight className="h-4 w-4 text-blue-200 group-active:text-blue-600 transition-colors" />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-blue-50 pt-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 text-blue-200" />
                      <span className="text-[11px] font-black uppercase tracking-tight text-blue-700/70">{item.units} Units</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-blue-200" />
                      <span className={`text-[11px] font-black uppercase tracking-tight ${item.status === 'overdue' ? 'text-rose-600' : 'text-blue-700/70'}`}>
                        {item.due}
                      </span>
                    </div>
                  </div>
                  
                  {item.status === 'picking' ? (
                    <div className="flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-[9px] font-black uppercase tracking-wider text-amber-700">In Progress</span>
                    </div>
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-blue-200">Ready to Pick</span>
                  )}
                </div>
              </MobileCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
