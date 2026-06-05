'use client';

import { motion } from 'framer-motion';
import { 
  ChevronLeft, 
  Package, 
  MapPin, 
  Clock, 
  User, 
  ShoppingCart,
  Check,
  Edit,
  ExternalLink,
  Clipboard,
  MoreVertical,
  History
} from '@/components/Icons';
import { 
  MobileCard, 
  MobilePageHeader, 
  TOKENS,
  BentoItem,
  SectionHeader,
  GlassButton
} from '@/components/mobile/redesign/DesignSystem';
import { useRouter } from 'next/navigation';

export default function RedesignedMobileOrderDetail({ orderId }: { orderId: string }) {
  const router = useRouter();

  // Mock data for UI
  const order = {
    id: orderId,
    status: 'Ready to Ship',
    product: 'Sony WH-1000XM5 Wireless Headphones',
    sku: 'SONY-WH1000XM5-B',
    customer: 'Johnathan Doe',
    address: 'Los Angeles, CA 90210',
    units: 2,
    date: 'Jun 5, 2026',
    source: 'eBay'
  };

  return (
    <div className={`min-h-screen ${TOKENS.colors.background} px-4 pb-40 pt-2`}>
      {/* Header */}
      <div className="flex items-center justify-between py-2 px-1">
        <button 
          onClick={() => router.back()}
          className="h-10 w-10 rounded-full bg-white border border-blue-100 flex items-center justify-center text-blue-400 shadow-sm active:scale-90 transition-all"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
            <div className="bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.1em] border border-blue-100 shadow-sm">
            {order.status}
            </div>
            <button className="h-10 w-10 rounded-full bg-white border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm active:scale-90 transition-all">
                <MoreVertical className="h-5 w-5" />
            </button>
        </div>
      </div>

      <MobilePageHeader 
        title={order.id} 
        subtitle={`Channel: ${order.source} • Received ${order.date}`}
      />

      <div className="grid grid-cols-2 gap-4 mt-2">
        {/* Product Card */}
        <BentoItem title="Product" icon={Package} className="col-span-2" variant="glass">
          <p className="text-base font-black text-blue-950 leading-snug tracking-tight">{order.product}</p>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg border border-blue-100 font-mono">
              {order.sku}
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg border border-emerald-100">
              {order.units} Units
            </span>
          </div>
        </BentoItem>

        {/* Customer Card */}
        <BentoItem title="Customer" icon={User}>
          <p className="text-sm font-black text-blue-950 tracking-tight">{order.customer}</p>
          <p className="text-[10px] text-blue-300 font-bold uppercase tracking-widest mt-1.5">Verified Account</p>
        </BentoItem>

        {/* Location Card */}
        <BentoItem title="Destination" icon={MapPin}>
          <p className="text-sm font-black text-blue-950 tracking-tight truncate">{order.address}</p>
          <p className="text-[10px] text-blue-300 font-bold uppercase tracking-widest mt-1.5">Standard Ground</p>
        </BentoItem>

        {/* Timeline Preview */}
        <div className="col-span-2 mt-4">
          <SectionHeader 
            title="Activity Timeline" 
            actionLabel="Full Logs" 
            onAction={() => {}} 
          />
          <MobileCard className="py-5">
            <div className="space-y-6">
                {[1, 2].map(i => (
                <div key={i} className="flex gap-4 items-start pl-1 relative">
                    {i === 1 && <div className="absolute left-[10px] top-6 bottom-[-24px] w-px bg-blue-50" />}
                    <div className="relative mt-1 shrink-0">
                        <div className={`h-2.5 w-2.5 rounded-full ${i === 1 ? 'bg-blue-600' : 'bg-blue-100'} z-10 relative`} />
                        {i === 1 && <div className="absolute -inset-1.5 bg-blue-400/20 rounded-full animate-ping" />}
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-black text-blue-950 uppercase tracking-tight">{i === 1 ? 'Allocation Completed' : 'Order Received'}</p>
                        <p className="text-[10px] font-bold text-blue-300 uppercase tracking-widest mt-1 flex items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            Jun 5 • 10:24 AM
                        </p>
                    </div>
                </div>
                ))}
            </div>
          </MobileCard>
        </div>
      </div>

      {/* Sticky Bottom Actions */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent pt-16 pointer-events-none">
        <div className="flex gap-3 pointer-events-auto">
          <GlassButton 
            variant="secondary" 
            className="w-14 px-0 shadow-lg border-blue-100"
            onClick={() => {}}
            icon={Edit}
          >
            {null}
          </GlassButton>
          <GlassButton 
            variant="primary" 
            className="flex-1 shadow-2xl shadow-blue-600/20"
            onClick={() => {}}
            icon={Check}
          >
            Process & Ship
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
