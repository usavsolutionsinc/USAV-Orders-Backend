'use client';

import { motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import {
  History,
  Barcode,
  ShoppingCart,
  Truck,
  Box,
  Lock
} from '@/components/Icons';
import { TOKENS } from './DesignSystem';

import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { MobileNavTabId, CANONICAL_MOBILE_NAV_TABS } from '@/lib/auth/mobile-display-config';

interface TabMeta {
  label: string;
  icon: any;
  href: string;
  isFab?: boolean;
}

const TAB_META: Record<MobileNavTabId, TabMeta> = {
  home: { label: 'Recent', icon: History, href: '/m/home' },
  receiving: { label: 'Receiving', icon: Truck, href: '/m/receiving' },
  scan: { label: 'Scan', icon: Barcode, href: '/m/scan', isFab: true },
  packing: { label: 'Packing', icon: Box, href: '/m/pack' },
  picks: { label: 'Picks', icon: ShoppingCart, href: '/m/pick' },
  signout: { label: 'Sign out', icon: Lock, href: '/signin' },
};

export const RedesignedBottomNav = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

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

  // Render the single canonical layout for everyone, not the per-staff `tabs`
  // blob — the bar must be identical regardless of which roles the signed-in
  // staffer holds (Recent · Receiving · [Scan] · Packing · Picks).
  const tabs = CANONICAL_MOBILE_NAV_TABS.map(id => ({
    id,
    ...TAB_META[id]
  })).filter(t => t.label);

  // No app nav until someone's signed in. Guards the mobile sign-in screen,
  // which the edge proxy serves under the /m shell via rewrite (so the path is
  // '/signin' and the route is /m/signin) — without this the bar flashes there.
  if (!user) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[100] pointer-events-none">
      <div className={`
        w-full h-16 pb-[env(safe-area-inset-bottom)]
        ${TOKENS.colors.surface}
        flex items-center justify-around px-2
        border-t border-slate-200/70 backdrop-blur-3xl
        shadow-[0_-8px_24px_rgba(0,0,0,0.06)]
        pointer-events-auto
      `}>
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || (tab.href !== '/m/home' && pathname?.startsWith(tab.href));
          const Icon = tab.icon;

          if (tab.isFab) {
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id, tab.href)}
                aria-label={tab.label}
                className="flex items-center justify-center flex-1 min-w-0"
              >
                <motion.span
                  whileTap={TOKENS.motion.tap}
                  className={`
                    h-12 w-12 flex items-center justify-center
                    bg-blue-600 text-white rounded-2xl
                    shadow-[0_6px_16px_rgba(37,99,235,0.35)]
                    active:scale-90 transition-all
                    ${isActive ? 'ring-2 ring-blue-200' : ''}
                  `}
                >
                  <Icon className="h-6 w-6" />
                </motion.span>
              </button>
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
