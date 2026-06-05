'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { RedesignedBottomNav } from './RedesignedBottomNav';
import { TOKENS } from './DesignSystem';

/**
 * Global Mobile Shell for 2026 Redesign
 */

export const RedesignedMobileShell = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  // Paths that should hide the bottom nav (e.g., camera flows)
  const hideNavPaths = [
    '/m/signin',
  ];
  
  const showNav = !hideNavPaths.some(p => pathname?.startsWith(p));

  return (
    <div className={`flex h-[100dvh] min-h-0 flex-col ${TOKENS.colors.background} font-sans antialiased overflow-hidden`}>
      {/* Page Content with Transitions */}
      <main className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain pb-safe">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ 
              duration: 0.2,
              ease: [0.23, 1, 0.32, 1] // Custom ease-out
            }}
            className="min-h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Shared Bottom Nav */}
      {showNav && <RedesignedBottomNav />}
    </div>
  );
};
