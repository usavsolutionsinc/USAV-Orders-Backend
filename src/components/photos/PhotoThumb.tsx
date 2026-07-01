'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { zIndex } from '@/design-system/tokens/z-index';
import { AlertTriangle, Image as ImageIcon } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

/** Prefetch GCS thumbnails shortly before they enter the scrollport. */
const THUMB_PREFETCH_MARGIN = '400px 0px';

/**
 * The single image primitive for every photo-library tile.
 *
 * Thumbnails are signed GCS URLs — we defer the network request until the tile
 * is near the viewport (IntersectionObserver + native `loading="lazy"`) so a
 * page of metadata does not pull every object at once.
 */
export function PhotoThumb({
  src,
  alt,
  ratio = 'square',
  damage = false,
  className,
  heroId,
}: {
  src: string;
  alt: string;
  /**
   * `square` 1:1 crop · `portrait` phone 9:16 frame, full image (object-contain) ·
   * `natural` self-sizing masonry · `fill` fills its box.
   */
  ratio?: 'square' | 'portrait' | 'natural' | 'fill';
  /** Surfaces a small damage dot — the one status worth flagging on the tile. */
  damage?: boolean;
  className?: string;
  /**
   * Shared `layoutId` (from `photoHeroLayoutId`) pairing this tile with the
   * fullscreen viewer's main image, so opening it morphs THIS tile into the
   * lightbox rather than crossfading two unrelated elements. Omit to render a
   * plain (non-shared-layout) tile.
   */
  heroId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const reduce = useReducedMotion();
  const heroTransition = useMotionTransition(framerTransition.photoHeroMorph);
  const cover = ratio === 'square' || ratio === 'fill';
  // The hero morph's close-side handoff (viewer → this tile) plays a layout
  // animation ON this element — its projected box briefly overshoots the tile's
  // own cell into neighboring rows. Grid siblings paint in DOM order by default,
  // so a later row would otherwise draw over the still-traveling photo; bump
  // z-index only for that window so it clears every row, then drop back to flow.
  const [isMorphing, setIsMorphing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || shouldLoad) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: THUMB_PREFETCH_MARGIN, threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    setStatus('loading');
  }, [shouldLoad, src]);

  return (
    <motion.div
      ref={containerRef}
      layoutId={reduce ? undefined : heroId}
      transition={heroTransition}
      onLayoutAnimationStart={() => setIsMorphing(true)}
      onLayoutAnimationComplete={() => setIsMorphing(false)}
      style={{ zIndex: isMorphing ? zIndex.raised : undefined }}
      className={cn(
        'relative overflow-hidden bg-gray-100',
        ratio === 'square' ? 'aspect-square'
          : ratio === 'portrait' ? 'aspect-[9/16]'
          : ratio === 'fill' ? 'h-full w-full'
          : ratio === 'natural'
            ? status === 'loaded' ? '' : 'aspect-[4/3]'
            : status === 'loaded' ? '' : 'aspect-[4/5]',
        className,
      )}
    >
      {status === 'loading' ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-0 bg-gradient-to-br from-gray-100 via-gray-200/70 to-gray-100',
            reduce ? '' : 'animate-pulse',
          )}
        />
      ) : null}

      {status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-50 text-gray-400">
          <ImageIcon className="h-5 w-5" />
          <span className="text-[8.5px] font-bold uppercase tracking-widest">Unavailable</span>
        </div>
      ) : shouldLoad ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={cn(
            ratio === 'portrait'
              ? 'h-full w-full object-contain'
              : cover
                ? 'h-full w-full object-cover'
                : 'block h-auto w-full',
            'transition-opacity',
            reduce ? 'duration-0' : 'duration-500',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}

      {damage ? (
        <HoverTooltip label="Damage detected" focusable={false}>
          <span className="absolute right-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow-sm ring-2 ring-white">
            <AlertTriangle className="h-2.5 w-2.5" />
          </span>
        </HoverTooltip>
      ) : null}
    </motion.div>
  );
}
