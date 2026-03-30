'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/utils/_cn';

interface StationHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  onBack?: () => void;
  rightActions?: React.ReactNode;
  className?: string;
}

export function StationHeader({
  title,
  subtitle,
  backHref,
  onBack,
  rightActions,
  className,
}: StationHeaderProps) {
  const backEl =
    backHref ? (
      <Link
        href={backHref}
        className="flex items-center justify-center w-11 h-11 -ml-2 rounded-station text-gray-500 hover:text-navy-800 hover:bg-navy-50 transition-colors touch-manipulation"
        aria-label="Back"
      >
        <ChevronLeft size={20} strokeWidth={2} />
      </Link>
    ) : onBack ? (
      <button
        onClick={onBack}
        className="flex items-center justify-center w-11 h-11 -ml-2 rounded-station text-gray-500 hover:text-navy-800 hover:bg-navy-50 transition-colors touch-manipulation"
        aria-label="Back"
      >
        <ChevronLeft size={20} strokeWidth={2} />
      </button>
    ) : null;

  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex items-center h-14 px-4 gap-2',
        'bg-white border-b border-gray-200',
        // iOS safe area top inset
        'pt-[env(safe-area-inset-top,0px)]',
        className,
      )}
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0px)' }}
    >
      {/* Back */}
      {backEl && <div className="shrink-0">{backEl}</div>}

      {/* Center: subtitle + title */}
      <div className="flex-1 min-w-0">
        {subtitle && (
          <p className="text-[9px] font-bold tracking-[0.15em] uppercase text-navy-700 leading-none mb-0.5 font-sans">
            {subtitle}
          </p>
        )}
        <h1 className="text-base font-bold text-gray-900 leading-tight truncate font-sans">
          {title}
        </h1>
      </div>

      {/* Right actions */}
      {rightActions && (
        <div className="shrink-0 flex items-center gap-2">{rightActions}</div>
      )}
    </header>
  );
}
