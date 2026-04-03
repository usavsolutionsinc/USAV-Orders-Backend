'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { InlineNotice } from '@/design-system/components';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/design-system/components';
import {
  ASSIGN_SESSION_FEEDBACK_EVENT,
  OPEN_ASSIGN_SESSION_EVENT,
  type AssignSessionFeedbackDetail,
} from '@/components/work-orders/assign-session-events';
import { sectionLabel, dataValue, chipText, fieldLabel } from '@/design-system/tokens/typography/presets';
import {
  type QueueKey,
  type QueueCounts,
  QUEUE_ITEMS,
  EMPTY_COUNTS,
  normalizeQueue,
} from '@/components/work-orders/types';

const ASSIGNMENT_FOCUS_TABS = [
  { id: 'all_unassigned', label: 'Unassigned', color: 'orange' as const },
  { id: 'all_assigned', label: 'Assigned', color: 'emerald' as const },
];

const SIDEBAR_QUEUE_ITEMS = QUEUE_ITEMS.filter(
  (item) => item.key !== 'all_unassigned' && item.key !== 'all_assigned'
);

export function WorkOrdersSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [pickupDates, setPickupDates] = useState<Array<{ pickup_date: string; item_count: number; total_value: string }>>([]);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);
  const canStartAssignSession = queue !== 'local_pickups' && queue !== 'stock_replenish';

  useEffect(() => {
    setLocalSearch(searchParams.get('q') || '');
  }, [searchParams]);

  const fetchCounts = useCallback(() => {
    fetch(`/api/work-orders?queue=${queue}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.counts) setCounts({ ...EMPTY_COUNTS, ...json.counts });
      })
      .catch(() => {});
  }, [queue]);

  const fetchPickupDates = useCallback(() => {
    if (queue !== 'local_pickups') return;
    fetch(`/api/local-pickups`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (Array.isArray(json?.dates)) setPickupDates(json.dates);
      })
      .catch(() => setPickupDates([]));
  }, [queue]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => { fetchPickupDates(); }, [fetchPickupDates]);

  useEffect(() => {
    window.addEventListener('dashboard-refresh', fetchCounts);
    window.addEventListener('dashboard-refresh', fetchPickupDates);
    return () => {
      window.removeEventListener('dashboard-refresh', fetchCounts);
      window.removeEventListener('dashboard-refresh', fetchPickupDates);
    };
  }, [fetchCounts, fetchPickupDates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (localSearch.trim()) params.set('q', localSearch.trim());
      else params.delete('q');
      router.replace(`/work-orders?${params.toString()}`);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localSearch, router, searchParams]);

  const updateQueue = (nextQueue: QueueKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('queue', nextQueue);
    params.delete('entityType');
    params.delete('entityId');
    if (nextQueue !== 'local_pickups') params.delete('pickupDate');
    router.replace(`/work-orders?${params.toString()}`);
  };

  const updatePickupDate = (pickupDate: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('queue', 'local_pickups');
    params.set('pickupDate', pickupDate);
    params.delete('entityType');
    params.delete('entityId');
    router.replace(`/work-orders?${params.toString()}`);
  };

  useEffect(() => {
    if (queue !== 'local_pickups') return;
    if (searchParams.get('pickupDate')) return;
    if (!pickupDates[0]?.pickup_date) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('pickupDate', pickupDates[0].pickup_date);
    router.replace(`/work-orders?${params.toString()}`);
  }, [pickupDates, queue, router, searchParams]);

  useEffect(() => {
    const handleAssignFeedback = (event: Event) => {
      const detail = (event as CustomEvent<AssignSessionFeedbackDetail>).detail;
      setAssignFeedback(detail?.message || null);
    };

    window.addEventListener(ASSIGN_SESSION_FEEDBACK_EVENT as any, handleAssignFeedback as any);
    return () => {
      window.removeEventListener(ASSIGN_SESSION_FEEDBACK_EVENT as any, handleAssignFeedback as any);
    };
  }, []);

  return (
    <div className="font-dm-sans flex h-full flex-col overflow-hidden bg-white">
      <div className={`${sidebarHeaderBandClass} px-3 py-2`}>
        <TabSwitch
          tabs={ASSIGNMENT_FOCUS_TABS.map((tab) => ({
            id: tab.id,
            label: tab.label,
            count: counts[tab.id as QueueKey] ?? 0,
            color: tab.color,
          }))}
          activeTab={queue}
          onTabChange={(id) => updateQueue(id as QueueKey)}
        />
      </div>

      <div className={sidebarHeaderRowClass}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search queue, tracking, SKU…"
          variant="emerald"
          className="w-full"
        />
      </div>

      <div className={`${sidebarHeaderBandClass} px-3 pb-2`}>
        {assignFeedback && (
          <InlineNotice tone="warning" size="sm" className="mb-2">
            {assignFeedback}
          </InlineNotice>
        )}
        <button
          type="button"
          onClick={() => {
            setAssignFeedback(null);
            window.dispatchEvent(new CustomEvent(OPEN_ASSIGN_SESSION_EVENT));
          }}
          disabled={!canStartAssignSession}
          className={`h-11 w-full rounded-xl ${sectionLabel} transition-colors ${
            canStartAssignSession
              ? 'bg-gray-900 text-white hover:bg-black'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Start Assign Session
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {queue === 'local_pickups' && pickupDates.length > 0 && (
          <div className="mb-3 border-b border-gray-200 pb-2">
            <p className={`px-3 pb-2 ${sectionLabel}`}>
              Pickup Dates
            </p>
            {pickupDates.map((item) => {
              const active = searchParams.get('pickupDate') === item.pickup_date;
              const date = new Date(`${item.pickup_date}T12:00:00`);
              const label = Number.isNaN(date.getTime())
                ? item.pickup_date
                : new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  }).format(date);
              return (
                <button
                  key={item.pickup_date}
                  type="button"
                  onClick={() => updatePickupDate(item.pickup_date)}
                  className={`group relative flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors ${
                    active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className={dataValue}>{label}</div>
                    <div className={`mt-1 ${fieldLabel} text-gray-500`}>
                      {item.item_count} items · ${Number(item.total_value || 0).toFixed(2)}
                    </div>
                  </div>
                  {active && <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-gray-900 rounded-full" />}
                </button>
              );
            })}
          </div>
        )}

        {SIDEBAR_QUEUE_ITEMS.map((item) => {
          const active = item.key === queue;
          const count = counts[item.key] ?? 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => updateQueue(item.key)}
              className={`group relative flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors ${
                active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <span className={dataValue}>{item.label}</span>
              <span
                className={`min-w-[1.75rem] text-right ${chipText} tabular-nums ${
                  active ? 'text-gray-900' : count > 0 ? 'text-gray-600' : 'text-gray-300'
                }`}
              >
                {count}
              </span>
              {active && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-gray-900 rounded-full" />
              )}
              {!active && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-gray-900 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
