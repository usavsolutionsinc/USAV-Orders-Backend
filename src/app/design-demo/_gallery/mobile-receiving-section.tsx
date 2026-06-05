'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Camera,
  X,
  Check,
  Trash2,
  Sparkles,
  Zap,
  Package,
  ChevronLeft,
} from '@/components/Icons';
import { Bay, cx, Density } from './sections';

/* ════════════════════════ 2026 Camera Mock ════════════════════════════════ */

const spring = { type: 'spring', stiffness: 500, damping: 30 } as const;
const bouncy = { type: 'spring', stiffness: 400, damping: 15 } as const;

export function MobileReceivingSection({ density }: { density: Density }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Bay
        title="2026 Camera — Light Mode"
        promote="@/components/mobile/receiving/PhotoCaptureSurface"
        tag="upgrade"
        caption="A clean, high-utility light theme for warehouse environments. Floating controls over a bright viewfinder with a focus on speed and clarity. Replaces the dark-mode rapid capture UI."
        span={2}
      >
        <div className="relative h-[500px] w-full max-w-[360px] overflow-hidden rounded-[32px] bg-white shadow-2xl ring-8 ring-slate-100">
          <CameraMock />
        </div>
      </Bay>
    </div>
  );
}

function CameraMock() {
  const [shots, setShots] = useState<{ id: string; color: string }[]>([]);
  const [flash, setFlash] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const takePhoto = useCallback(() => {
    if (shots.length >= 24) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 50);

    const colors = ['bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400', 'bg-violet-400'];
    const newShot = {
      id: Math.random().toString(36).substring(7),
      color: colors[shots.length % colors.length],
    };

    setShots((prev) => [...prev, newShot]);
  }, [shots]);

  const removeShot = (id: string) => {
    setShots((prev) => prev.filter((s) => s.id !== id));
    if (previewIndex !== null) setPreviewIndex(null);
  };

  const lastShot = shots[shots.length - 1];

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-slate-50">
      {/* ── Viewfinder (Mock) ── */}
      <div className="absolute inset-0 bg-slate-100">
        <div className="absolute inset-0 flex items-center justify-center opacity-40">
          <div className="h-64 w-64 rounded-full border border-slate-300" />
          <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
        </div>
        
        {/* Shutter Flash (Dark/Inverted) */}
        <AnimatePresence>
          {flash && (
            <motion.div
              initial={{ opacity: 0.8 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-50 bg-slate-900"
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Floating HUD ── */}
      <div className="absolute top-6 inset-x-4 flex items-start justify-between z-10">
        <div className="flex flex-col gap-1.5">
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 backdrop-blur-md border border-slate-200 shadow-sm"
          >
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-900">PO 4421 Live</span>
          </motion.div>
        </div>

        <button className="h-10 w-10 flex items-center justify-center rounded-full bg-white/70 text-slate-900 backdrop-blur-md border border-slate-200 shadow-sm active:scale-95 transition-transform">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Camera Controls (Light Theme) ── */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-white via-white/80 to-transparent pb-12 pt-20 px-8">
        <div className="flex items-center justify-between">
          {/* Gallery / Last Photo Button */}
          <div className="w-14">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setShowGallery(true)}
              className={cx(
                "h-14 w-14 rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-100 flex items-center justify-center transition-all",
                shots.length === 0 && "opacity-60"
              )}
            >
              {lastShot ? (
                <div className={cx("h-full w-full", lastShot.color)} />
              ) : (
                <Package className="h-6 w-6 text-slate-400" />
              )}
            </motion.button>
          </div>

          {/* Shutter */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={takePhoto}
              className="relative z-10 h-20 w-20 rounded-full border-[6px] border-slate-200 p-1.5"
            >
              <div className="h-full w-full rounded-full bg-slate-900 shadow-xl" />
            </motion.button>
            {/* Shutter Ring Animation on Click */}
            <AnimatePresence>
               {flash && (
                 <motion.div 
                   initial={{ scale: 0.8, opacity: 1 }}
                   animate={{ scale: 1.4, opacity: 0 }}
                   className="absolute inset-0 rounded-full border-2 border-slate-900/20"
                 />
               )}
            </AnimatePresence>
          </div>

          {/* Done / Confirm */}
          <div className="w-14">
            <motion.button
              animate={{ opacity: shots.length > 0 ? 1 : 0.4 }}
              className="h-14 w-14 flex items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 active:bg-emerald-600 transition-colors"
            >
              <Check className="h-6 w-6" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── Full Display Gallery Overlay ── */}
      <AnimatePresence>
        {showGallery && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={spring}
            className="absolute inset-0 z-[100] bg-white flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-8">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-900">Gallery ({shots.length})</h2>
              <button 
                onClick={() => setShowGallery(false)}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto px-6 pb-20">
              <div className="grid grid-cols-3 gap-2">
                {shots.map((shot, i) => (
                  <motion.div
                    key={shot.id}
                    layoutId={`gallery-${shot.id}`}
                    onClick={() => setPreviewIndex(i)}
                    className={cx("aspect-square rounded-2xl cursor-pointer relative shadow-sm", shot.color)}
                  >
                    <span className="absolute bottom-2 left-2 text-[10px] font-black text-white/80">{i + 1}</span>
                  </motion.div>
                ))}
              </div>
              {shots.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full opacity-20">
                  <Package className="h-12 w-12 text-slate-900 mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">No photos</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full Display Preview ── */}
      <AnimatePresence>
        {previewIndex !== null && shots[previewIndex] && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0 z-[200] bg-white flex flex-col"
          >
            <div className="absolute top-8 inset-x-6 flex items-center justify-between z-10">
              <button 
                onClick={() => setPreviewIndex(null)}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-sm border border-slate-200"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button 
                onClick={() => removeShot(shots[previewIndex].id)}
                className="h-10 w-10 flex items-center justify-center rounded-full bg-white/90 text-red-600 shadow-sm border border-red-500/20 backdrop-blur-md active:bg-white transition-colors"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
            
            <div className={cx("flex-1", shots[previewIndex].color)} />
            
            <div className="p-8 text-center bg-gradient-to-t from-white to-transparent">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                Photo {previewIndex + 1} of {shots.length}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
