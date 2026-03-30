import React from 'react';
import { cn } from '@/utils/_cn';

interface SkeletonLineProps {
  width?: string;
  height?: string;
  className?: string;
}

function SkeletonLine({ width = 'w-3/5', height = 'h-3', className }: SkeletonLineProps) {
  return (
    <div
      className={cn(
        'rounded bg-gray-200 animate-pulse',
        width,
        height,
        className,
      )}
    />
  );
}

interface SkeletonRowProps {
  count?: number;
  hasSubtitle?: boolean;
  hasValue?: boolean;
  hasIcon?: boolean;
}

function SingleSkeletonRow({ hasSubtitle, hasValue, hasIcon }: SkeletonRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 border-b border-gray-100',
        hasSubtitle ? 'min-h-[72px] py-3' : 'min-h-[56px] py-2',
      )}
    >
      {hasIcon && <div className="shrink-0 w-9 h-9 rounded-station bg-gray-200 animate-pulse" />}
      <div className="flex-1 flex flex-col gap-2">
        <SkeletonLine width="w-3/5" height="h-3.5" />
        {hasSubtitle && <SkeletonLine width="w-2/5" height="h-2.5" />}
      </div>
      {hasValue && <SkeletonLine width="w-14" height="h-3" />}
    </div>
  );
}

export function SkeletonRow({
  count = 3,
  hasSubtitle = true,
  hasValue = false,
  hasIcon = true,
}: SkeletonRowProps) {
  return (
    <div>
      {Array.from({ length: count }, (_, i) => (
        <SingleSkeletonRow
          key={i}
          hasSubtitle={hasSubtitle}
          hasValue={hasValue}
          hasIcon={hasIcon}
        />
      ))}
    </div>
  );
}
