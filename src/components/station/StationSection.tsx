import React from 'react';
import { cn } from '@/utils/_cn';

interface StationSectionProps {
  label?: string;
  children?: React.ReactNode;
  padded?: boolean;
  className?: string;
}

export function StationSection({
  label,
  children,
  padded = false,
  className,
}: StationSectionProps) {
  return (
    <div className={cn('mb-6', className)}>
      {label && (
        <div className="flex items-center h-8 px-4 border-b border-gray-100">
          <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-gray-400 font-sans">
            {label}
          </span>
        </div>
      )}
      {children && (
        <div className={cn(padded && 'px-4 py-3')}>{children}</div>
      )}
    </div>
  );
}
