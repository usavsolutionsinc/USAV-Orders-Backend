'use client';

import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/design-system/primitives';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial state
    setIsOffline(!navigator.onLine);

    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 bg-navy-900 text-white">
            <div className="flex items-center gap-2">
              <WifiOff size={14} className="shrink-0 text-navy-200" />
              <span className="text-micro font-bold tracking-[0.12em] uppercase font-sans text-navy-100">
                Working offline — scans will sync when reconnected
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={12} />}
              onClick={() => window.location.reload()}
              ariaLabel="Retry connection"
              className="h-auto gap-1 px-0 py-0 font-sans text-micro font-bold uppercase tracking-wide text-navy-300 hover:bg-transparent hover:text-white touch-manipulation"
            >
              Retry
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
