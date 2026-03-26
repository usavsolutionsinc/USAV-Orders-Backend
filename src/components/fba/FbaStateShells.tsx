'use client';

import { Loader2 } from '@/components/Icons';
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
    <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-gray-50">
      <div className="text-center">
        <Loader2 className={`mx-auto h-8 w-8 animate-spin ${colors.text}`} />
        <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-gray-700">
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
    <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-gray-50">
      <div className="max-w-sm rounded-xl border border-red-200 bg-white px-6 py-5 text-center shadow-sm shadow-red-100/70">
        <p className="text-sm font-semibold text-red-600">{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={`mt-4 inline-flex items-center justify-center rounded-full border border-gray-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700 transition-colors ${colors.hover} hover:border-transparent hover:text-white`}
          >
            Retry
          </button>
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
    <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center text-gray-500">
      <p className="text-xs font-black uppercase tracking-[0.3em]">{title}</p>
      {subtitle ? <p className="mt-1 text-[11px]">{subtitle}</p> : null}
    </div>
  );
}
