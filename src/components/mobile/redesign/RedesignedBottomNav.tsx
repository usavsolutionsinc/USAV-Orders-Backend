'use client';

import { motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Barcode, 
  ShoppingCart, 
  PackageCheck, 
  Lock 
} from '@/components/Icons';
import { TOKENS } from './DesignSystem';

import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { MobileNavTabId } from '@/lib/auth/mobile-display-config';

interface TabMeta {
  label: string;
  icon: any;
  href: string;
  isFab?: boolean;
}

const TAB_META: Record<MobileNavTabId, TabMeta> = {
  home: { label: 'Home', icon: LayoutDashboard, href: '/m/home' },
  picks: { label: 'Picks', icon: ShoppingCart, href: '/m/pick' },
  scan: { label: 'Scan', icon: Barcode, href: '/m/scan', isFab: true },
  receiving: { label: 'Receiving', icon: PackageCheck, href: '/m/receive' },
  signout: { label: 'Sign out', icon: Lock, href: '/signin' },
};

export const RedesignedBottomNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { mobileDisplayConfig, signOut } = useAuth();

  const handleTabClick = async (tabId: string, href: string) => {
    if (tabId === 'signout') {
      try {
        await signOut();
        toast.success('Signed out');
      } catch {
        router.replace('/signin');
      }
      return;
    }
    router.push(href);
  };

  const tabs = mobileDisplayConfig.bottomNav.tabs.map(id => ({
    id,
    ...TAB_META[id as keyof typeof TAB_META]
  })).filter(t => t.label);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[100] px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div className={`
        relative mx-auto max-w-md h-20 
        ${TOKENS.colors.surface} ${TOKENS.radius.large}
        flex items-center justify-around px-4
        shadow-[0_20px_50px_rgba(0,0,0,0.15)]
        border border-white/40 backdrop-blur-3xl
        pointer-events-auto
      `}>
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || (tab.href !== '/m/home' && pathname?.startsWith(tab.href));
          const Icon = tab.icon;

          if (tab.isFab) {
            return (
              <div key={tab.id} className="relative -top-8">
                <motion.button
                  whileTap={TOKENS.motion.tap}
                  onClick={() => handleTabClick(tab.id, tab.href)}
                  className={`
                    h-16 w-16 flex items-center justify-center
                    bg-blue-600 text-white rounded-[24px]
                    shadow-[0_12px_24px_rgba(37,99,235,0.3)]
                    ring-[6px] ring-slate-50
                    active:scale-90 transition-all
                  `}
                >
                  <Icon className="h-8 w-8" />
                </motion.button>
              </div>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id, tab.href)}
              className="flex flex-col items-center justify-center gap-1.5 flex-1 min-w-0 transition-all relative py-2"
            >
              <motion.div
                animate={{ 
                  scale: isActive ? 1.15 : 1,
                  y: isActive ? -2 : 0
                }}
                className={isActive ? 'text-blue-600' : 'text-slate-400'}
              >
                <Icon className={`h-6 w-6 ${isActive ? 'fill-blue-600/10' : ''}`} />
              </motion.div>
              <span className={`
                text-[9px] font-black uppercase tracking-[0.1em] truncate w-full px-1 transition-colors
                ${isActive ? 'text-blue-600' : 'text-slate-400'}
              `}>
                {tab.label}
              </span>

              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute -bottom-1 h-1 w-5 rounded-full bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                  transition={TOKENS.motion.spring}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
  }
;
