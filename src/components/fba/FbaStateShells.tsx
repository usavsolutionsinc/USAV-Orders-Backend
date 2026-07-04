'use client';

import { Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import type { StationTheme } from '@/utils/staff-colors';
import { stationThemeColors } from '@/utils/staff-colors';

export function FbaLoadingState({
  theme,
  label = 'Loading…',
}: {
  theme: StationTheme;
  label?: string;
}) {
  const colors = stationThemeColors[theme];
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-surface-canvas">
      <div className="text-center">
        <Loader2 className={`mx-auto h-8 w-8 animate-spin ${colors.text}`} />
        <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-text-muted">
          {label}
        </p>
      </div>
    </div>
  );
}

export function FbaErrorState({
  message,
  onRetry,
  theme,
}: {
  message: string;
  onRetry?: () => void;
  theme: StationTheme;
}) {
  const colors = stationThemeColors[theme];
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-surface-canvas">
      <div className="max-w-sm rounded-xl border border-red-200 bg-surface-card px-6 py-5 text-center shadow-sm shadow-red-100/70">
        <p className="text-sm font-semibold text-red-600">{message}</p>
        {onRetry ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className={`mt-4 border border-border-soft text-text-muted ${colors.hover} hover:border-transparent hover:text-white`}
          >
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FbaEmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center text-text-soft">
      <p className="text-xs font-black uppercase tracking-[0.3em]">{title}</p>
      {subtitle ? <p className="mt-1 text-caption">{subtitle}</p> : null}
    </div>
  );
}
