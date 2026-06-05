'use client';

import { motion } from 'framer-motion';
import { 
  Package, 
  Plus,
  PackageCheck,
  ChevronRight,
  Barcode,
  Search,
  X,
  History
} from '@/components/Icons';
import { 
  MobilePageHeader, 
  MobileCard, 
  TOKENS,
  SectionHeader,
  GlassButton
} from '@/components/mobile/redesign/DesignSystem';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function RedesignedMobileDashboard() {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} px-4 pb-12 pt-2`}>
      {/* Top App Bar - Root Hub (No Close Button) */}
      <div className="flex items-center justify-between py-2 px-1">
        <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/20">
          <Barcode className="h-5 w-5" />
        </div>
        <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-400">
           {/* Placeholder for profile/settings if needed */}
           <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
        </div>
      </div>

      <MobilePageHeader 
        title="Operations Hub"
        subtitle={`Logged in as ${user?.name || 'Michael T.'}`}
      />

      {/* Quick Action Bar */}
      <div className="flex gap-3 mb-8">
        <GlassButton 
          variant="primary" 
          className="flex-1 !h-14 !text-[11px]" 
          onClick={() => router.push('/m/scan')}
          icon={Search}
        >
          Universal Scan
        </GlassButton>
        <GlassButton 
          variant="secondary" 
          className="flex-1 !h-14 !text-[11px]" 
          onClick={() => router.push('/m/receive')}
          icon={Plus}
        >
          Receive Stock
        </GlassButton>
      </div>

      {/* Main Focus: Recent Scans */}
      <div className="mt-2">
        <SectionHeader 
          title="Recent Activity" 
          actionLabel="View All" 
          onAction={() => {}} 
        />
        
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <MobileCard key={i} className="flex items-center gap-4 py-3.5 group">
              <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shadow-sm ${i % 2 === 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                {i % 2 === 0 ? <PackageCheck className="h-6 w-6" /> : <Package className="h-6 w-6" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-sm font-black text-blue-950 truncate tracking-tight">
                    {i % 2 === 0 ? `Order #102${i} Shipped` : `Item ${i * 42} Received`}
                  </p>
                  <span className="text-[9px] font-bold text-blue-300 uppercase">{i}m ago</span>
                </div>
                <p className="text-[10px] font-bold text-blue-700/60 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3 w-3 text-blue-200" />
                  Processed by {user?.name?.split(' ')[0] || 'Michael'}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-blue-100 group-active:translate-x-1 transition-transform" />
            </MobileCard>
          ))}
        </div>
      </div>

    </div>
  );
}
