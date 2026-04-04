'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { ChevronLeft, AlertCircle, Loader2, Image as ImageIcon } from '@/components/Icons';
import { MobilePackingConfirmCard } from './MobilePackingConfirmCard';
import type { ActivePackingOrder, ActiveFbaScan, CapturedPhoto } from './MobileStationPacking';

// ─── Types ──────────────────────────────────────────────────────────────────

type OrderVariant = 'order' | 'fba' | 'repair' | 'exception';

interface MobilePackingReviewStepProps {
  order: ActivePackingOrder | null;
  fba: ActiveFbaScan | null;
  variant: OrderVariant;
  photos: CapturedPhoto[];
  isLoading: boolean;
  errorMessage: string | null;
  onComplete: () => void;
  onBack: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobilePackingReviewStep({
  order,
  fba,
  variant,
  photos,
  isLoading,
  errorMessage,
  onComplete,
  onBack,
}: MobilePackingReviewStepProps) {
  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        disabled={isLoading}
        className="flex items-center gap-1 text-[11px] font-bold text-gray-500 active:text-gray-700 transition-colors disabled:opacity-50"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Photos
      </button>

      {/* Compact order summary card (read-only) */}
      <MobilePackingConfirmCard
        order={order}
        fba={fba}
        variant={variant}
        scannedValue=""
        onConfirm={() => {}}
        onReject={() => {}}
        compact
      />

      {/* Photos grid */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-gray-400" />
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
              Photos ({photos.length})
            </p>
          </div>
          {photos.length === 0 && (
            <span className="text-[10px] font-bold text-amber-600">No photos attached</span>
          )}
        </div>

        {photos.length > 0 && (
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              <AnimatePresence initial={false}>
                {photos.map((photo, i) => (
                  <motion.div
                    key={`review-${photo.blobUrl}-${i}`}
                    initial={framerPresenceMobile.photoThumb.initial}
                    animate={framerPresenceMobile.photoThumb.animate}
                    transition={framerTransitionMobile.photoThumb}
                    className="relative aspect-square rounded-xl overflow-hidden border border-gray-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.previewUrl}
                      alt={`Photo ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md">
                      {i + 1}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-3 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-xs font-bold">{errorMessage}</p>
        </div>
      )}

      {/* Complete button */}
      <button
        type="button"
        onClick={onComplete}
        disabled={isLoading}
        className="w-full h-[56px] rounded-2xl bg-emerald-600 text-white text-[13px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-colors active:bg-emerald-700 disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Complete Packing
          </>
        )}
      </button>
    </div>
  );
}
