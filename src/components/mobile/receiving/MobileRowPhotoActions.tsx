'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { Camera, Image as ImageIcon } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';

interface MobileRowPhotoActionsProps {
  photoCount: number;
  galleryHref: string;
  captureHref: string;
  className?: string;
  /** When set and photos exist, opens the in-sheet swipe viewer instead of navigating away. */
  onOpenGallery?: () => void;
}

const BTN =
  'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-lg border px-2 transition-colors active:scale-[0.97]';

/** Match filled width (icon + xN) so empty and filled gallery buttons align in every row. */
const GALLERY_BTN = cn(BTN, 'min-w-11');

/**
 * Collapsed-row photo affordances: gallery (left) and capture (right).
 * `pointer-events-auto` + click stopPropagation so row tap doesn't open the sheet.
 */
export function MobileRowPhotoActions({
  photoCount,
  galleryHref,
  captureHref,
  className,
  onOpenGallery,
}: MobileRowPhotoActionsProps) {
  const safeCount = Math.max(0, photoCount);
  const hasPhotos = safeCount > 0;
  const disabled = captureHref === '#' && galleryHref === '#';

  if (disabled) return null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  const openGallery = (e: MouseEvent) => {
    stop(e);
    e.preventDefault();
    onOpenGallery?.();
  };

  const galleryClass = cn(
    GALLERY_BTN,
    hasPhotos
      ? 'border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100'
      : 'border-gray-200 bg-gray-50 text-gray-400 active:bg-gray-100',
  );

  return (
    <div className={cn('pointer-events-auto flex shrink-0 items-center gap-1', className)}>
      {onOpenGallery ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<ImageIcon />}
          onClick={openGallery}
          ariaLabel={hasPhotos ? `View ${safeCount} photos` : 'Open photo gallery'}
          className={galleryClass}
        >
          {hasPhotos ? <span className="text-caption font-black tabular-nums">x{safeCount}</span> : undefined}
        </Button>
      ) : (
        <Link
          href={galleryHref}
          prefetch={false}
          onClick={stop}
          aria-label={hasPhotos ? `View ${safeCount} photos` : 'Open photo gallery'}
          className={galleryClass}
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {hasPhotos ? <span className="text-caption font-black tabular-nums">x{safeCount}</span> : null}
        </Link>
      )}
      <Link
        href={captureHref}
        prefetch={false}
        onClick={stop}
        aria-label="Take more photos"
        className={cn(BTN, 'border-blue-600 bg-blue-600 text-white active:bg-blue-700')}
      >
        <Camera className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
