'use client';

import { ColumnsOne, ColumnsThree, ColumnsTwo, Loader2, RefreshCw } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  PHOTO_GRID_DENSITY_LABELS,
  PHOTO_GRID_DENSITY_ORDER,
  type PhotoGridDensity,
} from '@/lib/photos/photo-grid-density';
import { cn } from '@/utils/_cn';
import { photoLibraryControlButtonClass, photoLibraryControlGroupClass } from './photo-library-controls';

const DENSITY_ICONS: Record<PhotoGridDensity, typeof ColumnsOne> = {
  sm: ColumnsThree,
  md: ColumnsTwo,
  lg: ColumnsOne,
};

export interface PhotoGridDisplayControlsProps {
  density: PhotoGridDensity;
  onDensityChange: (density: PhotoGridDensity) => void;
  /** When set, renders a refresh control to the right of the density toggle. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Top-right grid density + optional refresh — shared by the media library header,
 * folder leaf views, and embedded pickers (support attach, Zendesk claim).
 */
export function PhotoGridDisplayControls({
  density,
  onDensityChange,
  onRefresh,
  isRefreshing = false,
  disabled = false,
  className,
}: PhotoGridDisplayControlsProps) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1', className)}>
      <div
        className={cn(photoLibraryControlGroupClass, disabled && 'opacity-50')}
        role="group"
        aria-label="Grid size"
      >
        {PHOTO_GRID_DENSITY_ORDER.map((id) => {
          const active = density === id;
          const Icon = DENSITY_ICONS[id];
          const label = PHOTO_GRID_DENSITY_LABELS[id];
          return (
            <HoverTooltip key={id} label={label} asChild>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onDensityChange(id)}
                className={cn('ds-raw-button', photoLibraryControlButtonClass(active, 'w-7'))}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </HoverTooltip>
          );
        })}
      </div>

      {onRefresh ? (
        <HoverTooltip label="Refresh photos" asChild>
          <button
            type="button"
            aria-label="Refresh photos"
            disabled={disabled || isRefreshing}
            onClick={onRefresh}
            className={cn(
              'ds-raw-button flex h-8 w-8 items-center justify-center rounded-lg border border-border-soft bg-surface-card text-text-soft transition-colors',
              'hover:bg-surface-sunken hover:text-text-default disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        </HoverTooltip>
      ) : null}
    </div>
  );
}
