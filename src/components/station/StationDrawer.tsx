'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/utils/_cn';

interface StationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** 'bottom' (default mobile sheet) | 'right' (desktop side panel) */
  side?: 'bottom' | 'right';
  className?: string;
}

const SPRING = { type: 'spring' as const, stiffness: 340, damping: 30 };

export function StationDrawer({
  isOpen,
  onClose,
  title,
  children,
  side = 'bottom',
  className,
}: StationDrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const panelVariants =
    side === 'bottom'
      ? { hidden: { y: '100%' }, visible: { y: 0 } }
      : { hidden: { x: '100%' }, visible: { x: 0 } };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-black/45"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={panelVariants}
            transition={SPRING}
            className={cn(
              'fixed z-50 bg-white overflow-hidden',
              side === 'bottom'
                ? 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[16px] pb-[env(safe-area-inset-bottom,0px)]'
                : 'inset-y-0 right-0 w-80 sm:w-96 shadow-xl',
              className,
            )}
          >
            {/* Handle (bottom sheet only) */}
            {side === 'bottom' && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-9 h-1 rounded-full bg-gray-300" />
              </div>
            )}

            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-bold text-gray-900 font-sans">{title}</h2>
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-8 h-8 rounded-station text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors touch-manipulation"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="overflow-y-auto overscroll-contain h-full">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
