'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresenceMobile,
  framerTransitionMobile,
} from '@/design-system/foundations/motion-framer';
import { Clock, Camera, ChevronRight, Image, Edit, X, Trash2, RotateCcw } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { PhotoCapture } from '@/components/station/PhotoCapture';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LastOrderPhoto {
  id: number;
  url: string;
  photoType: string;
  createdAt: string;
}

interface LastOrder {
  packerLogId: number;
  trackingType: string;
  packedAt: string;
  tracking: string | null;
  carrier: string | null;
  orderId: string | null;
  productTitle: string | null;
  condition: string | null;
  quantity: number;
  sku: string | null;
  itemNumber: string | null;
  photos: LastOrderPhoto[];
}

interface MobileLastOrderCardProps {
  staffId: number | string;
  packerId: string;
  /** Trigger a refetch when this value changes (e.g. increment after pack complete). */
  refreshKey?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function carrierBadgeColor(carrier: string | null): string {
  const c = (carrier || '').toLowerCase();
  if (c.includes('ups')) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (c.includes('fedex')) return 'bg-purple-100 text-purple-700 border-purple-200';
  if (c.includes('usps')) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileLastOrderCard({ staffId, packerId, refreshKey = 0 }: MobileLastOrderCardProps) {
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isAddingPhoto, setIsAddingPhoto] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // ── Fetch last order ──

  const fetchLastOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/packing-logs/last-order?staffId=${staffId}`);
      const data = await res.json();
      setLastOrder(data.lastOrder ?? null);
    } catch {
      setLastOrder(null);
    } finally {
      setIsLoading(false);
    }
  }, [staffId]);

  useEffect(() => {
    fetchLastOrder();
  }, [fetchLastOrder, refreshKey]);

  // Also refetch on the custom event fired after pack complete
  useEffect(() => {
    const handler = () => fetchLastOrder();
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [fetchLastOrder]);

  // ── Add photo handler ──

  const handleAddPhoto = useCallback(async (blob: Blob) => {
    if (!lastOrder) return;
    setIsUploading(true);

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const res = await fetch('/api/packing-logs/save-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo: base64,
          orderId: lastOrder.orderId || lastOrder.tracking || 'unknown',
          packerId,
          photoIndex: lastOrder.photos.length,
          packerLogId: lastOrder.packerLogId,
          photoType: 'packer_photo',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');

      // Append new photo to local state
      setLastOrder((prev) =>
        prev
          ? {
              ...prev,
              photos: [
                ...prev.photos,
                {
                  id: data.photoId ?? Date.now(),
                  url: data.path,
                  photoType: 'packer_photo',
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : prev,
      );
      setIsAddingPhoto(false);
    } catch (err: any) {
      console.error('Failed to add photo:', err);
    } finally {
      setIsUploading(false);
    }
  }, [lastOrder, packerId]);

  // ── Don't render if no data ──

  if (isLoading || !lastOrder) return null;

  const photoCount = lastOrder.photos.length;
  const hasPhotos = photoCount > 0;

  return (
    <>
      <motion.div
        initial={framerPresenceMobile.mobileCard.initial}
        animate={framerPresenceMobile.mobileCard.animate}
        transition={framerTransitionMobile.mobileCardMount}
        className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
      >
        {/* ── Collapsed header — always visible ── */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 active:bg-gray-50 transition-colors"
        >
          {/* Left accent + icon */}
          <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            {hasPhotos ? (
              <Image className="w-4.5 h-4.5 text-emerald-600" />
            ) : (
              <Camera className="w-4.5 h-4.5 text-emerald-600" />
            )}
          </div>

          {/* Summary */}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Last Packed</p>
              <span className="text-[9px] font-bold text-gray-300 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {timeAgo(lastOrder.packedAt)}
              </span>
            </div>
            <p className="text-[13px] font-black text-gray-900 truncate leading-tight mt-0.5">
              {lastOrder.productTitle || lastOrder.tracking || 'Unknown order'}
            </p>
          </div>

          {/* Photo count badge + chevron */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasPhotos && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 border border-gray-200 px-2 py-1 text-[10px] font-black text-gray-500 tabular-nums">
                <Image className="w-3 h-3" />
                {photoCount}
              </span>
            )}
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </motion.div>
          </div>
        </button>

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                height: { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] },
                opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
              }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
                {/* ── Order detail chips ── */}
                <div className="flex flex-wrap gap-2">
                  {lastOrder.orderId && (
                    <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-[10px] font-black text-gray-600">
                      #{getLast4(lastOrder.orderId)}
                    </span>
                  )}
                  {lastOrder.tracking && (
                    <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-[10px] font-mono font-bold text-gray-600">
                      TRK {getLast4(lastOrder.tracking)}
                    </span>
                  )}
                  {lastOrder.carrier && (
                    <span className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider ${carrierBadgeColor(lastOrder.carrier)}`}>
                      {lastOrder.carrier}
                    </span>
                  )}
                  {lastOrder.condition && (
                    <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-[10px] font-bold text-gray-500">
                      {lastOrder.condition}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-[10px] font-black text-gray-500 tabular-nums">
                    Qty {lastOrder.quantity}
                  </span>
                </div>

                {/* ── Photo thumbnails ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">
                      Photos ({photoCount})
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsAddingPhoto(true)}
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-600 active:text-emerald-700 transition-colors"
                    >
                      <Camera className="w-3 h-3" />
                      Add Photo
                    </button>
                  </div>

                  {hasPhotos ? (
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                      {lastOrder.photos.map((photo, i) => (
                        <motion.button
                          key={photo.id}
                          type="button"
                          onClick={() => setPreviewIndex(i)}
                          initial={framerPresenceMobile.photoThumb.initial}
                          animate={framerPresenceMobile.photoThumb.animate}
                          transition={framerTransitionMobile.photoThumb}
                          className="relative flex-shrink-0 w-[72px] h-[72px] rounded-xl overflow-hidden border-2 border-gray-200 active:border-emerald-400 transition-colors"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={`Photo ${i + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          <span className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[8px] font-black rounded px-1 py-0.5 tabular-nums">
                            {i + 1}
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsAddingPhoto(true)}
                      className="w-full h-16 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center gap-2 text-gray-400 active:border-emerald-300 active:text-emerald-500 transition-colors"
                    >
                      <Camera className="w-5 h-5" />
                      <span className="text-[11px] font-bold">No photos — tap to add</span>
                    </button>
                  )}
                </div>

                {/* ── Add photo inline capture ── */}
                <AnimatePresence>
                  {isAddingPhoto && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="relative">
                        {isUploading && (
                          <div className="absolute inset-0 z-10 bg-white/80 rounded-2xl flex items-center justify-center">
                            <p className="text-[11px] font-bold text-gray-500 animate-pulse">Uploading...</p>
                          </div>
                        )}
                        <PhotoCapture
                          onCapture={handleAddPhoto}
                          disabled={isUploading}
                          className="w-full"
                        />
                        <button
                          type="button"
                          onClick={() => setIsAddingPhoto(false)}
                          className="mt-2 w-full text-center text-[10px] font-bold text-gray-400 active:text-gray-600 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Fullscreen photo lightbox ── */}
      <AnimatePresence>
        {previewIndex !== null && lastOrder.photos[previewIndex] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[300] bg-black/95 flex flex-col"
            onClick={() => setPreviewIndex(null)}
          >
            {/* Top bar */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
              <p className="text-[11px] font-black text-white/60 tabular-nums">
                {previewIndex + 1} / {lastOrder.photos.length}
              </p>
              <button
                type="button"
                onClick={() => setPreviewIndex(null)}
                className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center active:bg-white/20 transition-colors"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image */}
            <div className="flex-1 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lastOrder.photos[previewIndex].url}
                alt={`Photo ${previewIndex + 1}`}
                className="max-w-full max-h-[70vh] rounded-xl object-contain"
              />
            </div>

            {/* Navigation dots + swipe hints */}
            <div className="flex-shrink-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4" onClick={(e) => e.stopPropagation()}>
              {/* Dot indicators */}
              {lastOrder.photos.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mb-4">
                  {lastOrder.photos.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPreviewIndex(i)}
                      className={`h-2 rounded-full transition-all ${
                        i === previewIndex ? 'w-5 bg-white' : 'w-2 bg-white/30'
                      }`}
                      aria-label={`View photo ${i + 1}`}
                    />
                  ))}
                </div>
              )}

              {/* Nav buttons */}
              <div className="flex items-center justify-center gap-4">
                {previewIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(previewIndex - 1)}
                    className="h-12 px-5 rounded-2xl bg-white/10 text-white text-[11px] font-black uppercase tracking-wider active:bg-white/20 transition-colors"
                  >
                    Prev
                  </button>
                )}
                {previewIndex < lastOrder.photos.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setPreviewIndex(previewIndex + 1)}
                    className="h-12 px-5 rounded-2xl bg-white/10 text-white text-[11px] font-black uppercase tracking-wider active:bg-white/20 transition-colors"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
