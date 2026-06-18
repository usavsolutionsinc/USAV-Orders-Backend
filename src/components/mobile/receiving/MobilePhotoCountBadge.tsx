'use client';

import Link from 'next/link';
import { Camera } from '@/components/Icons';
import { cn } from '@/utils/_cn';

interface MobilePhotoCountBadgeProps {
  count: number;
  /** When set and count &gt; 0, the badge links to the mobile gallery. */
  href?: string;
  onClick?: () => void;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Compact camera + xN count used on mobile receiving rows and the carton sheet.
 * Gray x0 empty state; blue when one or more photos exist.
 */
export function MobilePhotoCountBadge({
  count,
  href,
  onClick,
  className,
  size = 'sm',
}: MobilePhotoCountBadgeProps) {
  const safeCount = Math.max(0, count);
  const hasPhotos = safeCount > 0;
  const iconSize = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  const textSize = size === 'md' ? 'text-sm' : 'text-caption';

  const inner = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 font-black tabular-nums',
        textSize,
        hasPhotos ? 'text-blue-600' : 'text-gray-300',
        className,
      )}
      aria-label={`${safeCount} photo${safeCount === 1 ? '' : 's'}`}
    >
      <Camera className={cn(iconSize, hasPhotos ? 'text-blue-600' : 'text-gray-300')} />
      x{safeCount}
    </span>
  );

  if (href && hasPhotos) {
    return (
      <Link
        href={href}
        prefetch={false}
        onClick={onClick}
        className="inline-flex rounded-lg px-1 py-0.5 active:bg-blue-50"
      >
        {inner}
      </Link>
    );
  }

  if (onClick && hasPhotos) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex rounded-lg px-1 py-0.5 active:bg-blue-50"
      >
        {inner}
      </button>
    );
  }

  return inner;
}
