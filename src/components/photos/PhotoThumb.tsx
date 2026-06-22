'use client';

import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { AlertTriangle, Image as ImageIcon } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';

/**
 * The single image primitive for every photo-library tile.
 *
 * GCS thumbnails arrive over signed URLs that can be slow or, once a signature
 * expires, fail outright — so a bare `<img>` flashes empty boxes and broken-image
 * glyphs. This component owns the three states the brand cares about (a calm
 * shimmer while loading, a quiet fade-in on load, a self-explaining fallback on
 * error) so the grid never shows a torn image. Status is communicated with one
 * restrained icon, per the house "icon-first, minimal framing" aesthetic.
 *
 * `ratio="square"` is the dense contact-sheet tile; `ratio="natural"` lets the
 * image set its own height for the masonry browse view (reserving a portrait
 * box until the real height is known, so columns don't jump on first paint).
 */
export function PhotoThumb({
  src,
  alt,
  ratio = 'square',
  damage = false,
  className,
}: {
  src: string;
  alt: string;
  /** `square` 1:1 tile · `natural` self-sizing (masonry) · `fill` fills its box. */
  ratio?: 'square' | 'natural' | 'fill';
  /** Surfaces a small damage dot — the one status worth flagging on the tile. */
  damage?: boolean;
  className?: string;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const reduce = useReducedMotion();
  const cover = ratio !== 'natural';

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gray-100',
        // Square tiles are 1:1; fill stretches to its parent; natural tiles
        // reserve a portrait box only until the image reports its real height.
        ratio === 'square' ? 'aspect-square'
          : ratio === 'fill' ? 'h-full w-full'
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
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={cn(
            cover ? 'h-full w-full object-cover' : 'block h-auto w-full',
            'transition-opacity',
            reduce ? 'duration-0' : 'duration-500',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}

      {damage ? (
        <HoverTooltip label="Damage detected" focusable={false}>
          <span className="absolute right-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow-sm ring-2 ring-white">
            <AlertTriangle className="h-2.5 w-2.5" />
          </span>
        </HoverTooltip>
      ) : null}
    </div>
  );
}
