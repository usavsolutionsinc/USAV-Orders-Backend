'use client';

import { type ReactNode, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/utils/_cn';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { SearchBar } from '@/components/ui/SearchBar';
import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { PhoneIncoming, PhoneMissed } from '@/components/Icons';
import {
  CALL_DIRECTION_ITEMS,
  parseCallDirection,
  type CallDirectionFilter,
} from '@/components/sidebar/support/support-sidebar-shared';
import { useCallEvents, isNotConfigured } from './useVoiceQueries';

/**
 * Calls mode — the Monitor filter rail. Calls are observe-only: the stream
 * lives in the page body ({@link CallLogView}); this sidebar carries only the
 * ephemeral URL filters (`?direction=`, `?q=`) plus a small at-a-glance
 * summary. No durable selection — that's a Workbench tell.
 */
export function CallLogSidebar({ modeToggle = null }: { modeToggle?: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const direction = parseCallDirection(searchParams.get('direction'));
  const query = searchParams.get('q') ?? '';

  const setParam = useCallback(
    (key: 'direction' | 'q', value: string, dropWhenDefault: string | null = null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'calls');
      if (!value || value === dropWhenDefault) params.delete(key);
      else params.set(key, value);
      router.replace(`/support?${params.toString()}`);
    },
    [router, searchParams],
  );

  const { data, isLoading, error } = useCallEvents({ direction, query: query.trim() });
  const notConfigured = isNotConfigured(error);
  const items = data?.items ?? [];
  const missed = items.filter((c) => c.direction === 'missed').length;
  const inbound = items.filter((c) => c.direction === 'inbound').length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 px-2 pt-2">
        <SearchBar
          value={query}
          onChange={(v) => setParam('q', v)}
          onClear={() => setParam('q', '')}
          placeholder="Search caller or number…"
          variant="blue"
          size="compact"
        />
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', SIDEBAR_GUTTER, 'pb-6')}>
        {modeToggle}
        <SidebarNavOverlaySlider
          items={CALL_DIRECTION_ITEMS}
          value={direction}
          onChange={(id) => setParam('direction', id, 'all')}
          aria-label="Call direction"
        />
        <div className="space-y-5 pt-2">
        {notConfigured ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4">
            <p className="text-caption font-semibold text-gray-700">Call log not connected</p>
            <p className="mt-1 text-micro leading-5 text-gray-500">
              Connect Nextiva in Settings → Integrations to watch inbound, outbound, and missed
              calls here in real time.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <SummaryCell
                icon={<PhoneIncoming className="h-3.5 w-3.5 text-blue-500" />}
                label="Inbound"
                value={isLoading ? '·' : inbound}
              />
              <SummaryCell
                icon={<PhoneMissed className="h-3.5 w-3.5 text-rose-500" />}
                label="Missed"
                value={isLoading ? '·' : missed}
                emphasize={missed > 0}
              />
            </div>

            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4">
              <p className={sectionLabel}>Live call stream</p>
              <p className="mt-1 text-micro leading-5 text-gray-500">
                Filter the stream by direction or search a number. A missed call you need to chase
                opens its voicemail in the Voicemail tab.
              </p>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

function SummaryCell({
  icon,
  label,
  value,
  emphasize = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2.5">
      <p className="flex items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-gray-500">
        {icon}
        {label}
      </p>
      <p className={cn('mt-0.5 text-xl font-black tabular-nums leading-none', emphasize ? 'text-rose-600' : 'text-gray-900')}>
        {value}
      </p>
    </div>
  );
}
