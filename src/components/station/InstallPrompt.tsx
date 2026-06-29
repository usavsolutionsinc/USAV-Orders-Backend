'use client';

import React, { useEffect, useState } from 'react';
import { X, Share, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/design-system/primitives/Button';
import { IconButton } from '@/design-system/primitives/IconButton';

type Platform = 'ios' | 'android' | null;

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return null;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return 'ios';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  return null;
}

function isInStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

const STORAGE_KEY = 'usav-install-dismissed';

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (isInStandaloneMode()) return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;

    const p = detectPlatform();
    setPlatform(p);

    if (p === 'android') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }

    if (p === 'ios') {
      // Show iOS instructions after a short delay
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem(STORAGE_KEY, '1');
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShow(false);
    setDeferredPrompt(null);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="install-prompt"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="fixed bottom-4 inset-x-4 z-banner rounded-[12px] bg-navy-800 text-white shadow-xl overflow-hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-eyebrow font-bold tracking-[0.18em] uppercase text-navy-300 font-sans mb-0.5">
                  USAV Solutions
                </p>
                <p className="text-sm font-bold text-white font-sans">
                  Add to Home Screen
                </p>
              </div>
              <IconButton
                onClick={dismiss}
                ariaLabel="Dismiss"
                icon={<X size={14} className="text-white/60" />}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 transition-colors touch-manipulation"
              />
            </div>

            {platform === 'ios' ? (
              <div className="space-y-2">
                <p className="text-xs text-navy-200 font-sans leading-relaxed">
                  Install for the best station experience — works offline, no browser chrome.
                </p>
                <div className="flex items-center gap-2 text-xs text-white font-sans">
                  <span>1. Tap</span>
                  <Share size={14} className="text-navy-300" />
                  <span>in Safari, then</span>
                  <Plus size={14} className="text-navy-300" />
                  <span className="font-semibold">Add to Home Screen</span>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={dismiss}
                  className="flex-1 rounded-station border border-white/20 text-caption font-bold tracking-wide uppercase text-white/70 hover:bg-white/10 hover:text-white/70 touch-manipulation font-sans"
                >
                  Not now
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={install}
                  className="flex-1 rounded-station ring-0 bg-white text-navy-800 text-caption font-bold tracking-wide uppercase hover:bg-navy-50 touch-manipulation font-sans"
                >
                  Install
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
