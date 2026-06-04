'use client';

import { useCallback, useId, useRef, type ComponentType } from 'react';
import { useSiteTooltipOptional } from '@/components/providers/SiteTooltipProvider';
import { cn } from '@/utils/_cn';

interface IconWithTooltipProps {
  Icon: ComponentType<{ className?: string }>;
  label: string;
  iconClassName?: string;
  className?: string;
}

/**
 * Shared primitive for an icon with a hover tooltip.
 * Uses SiteTooltipProvider for a consistent, high-performance portal tooltip
 * with a native `title` fallback.
 */
export function IconWithTooltip({
  Icon,
  label,
  iconClassName,
  className,
}: IconWithTooltipProps) {
  const anchorId = useId();
  const ref = useRef<HTMLSpanElement | null>(null);
  const ctx = useSiteTooltipOptional();
  const getRect = useCallback(() => ref.current?.getBoundingClientRect() ?? null, []);

  return (
    <span
      ref={ref}
      onMouseEnter={() => ctx?.activate({ anchorId, value: label, getRect })}
      onMouseLeave={() => ctx?.scheduleClose(anchorId)}
      title={ctx ? undefined : label}
      aria-label={label}
      className={cn('inline-flex cursor-default items-center', className)}
    >
      <Icon className={cn('h-3.5 w-3.5', iconClassName)} />
    </span>
  );
}
