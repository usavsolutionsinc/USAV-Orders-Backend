'use client';

/**
 * Right-pane priority display for the triage → "Prioritize" queue
 * (`mode=triage&triview=found`). Two visual layers, both driven by the same
 * shared queue read — this pane never sorts or filters (the rail owns that); it
 * only *shows* the priority that `?sort=priority` already produced:
 *
 *   1. Focus header — for the carton currently open in the workspace: its
 *      priority tier, how long it's been waiting, and its position in the queue
 *      ("#2 of 12"). The aging signal that used to live in the sidebar band now
 *      sits where the operator is actually working.
 *   2. Queue overview — per-tier health tiles (count + oldest-waiting), a
 *      compact "what's the backlog" board modeled on the Incoming status tiles.
 *
 * Pure display: see the sidebar-mode contract — selection still flows
 * sidebar → pane, so these tiles are read-only stat cards, not filters.
 */

import { useMemo } from 'react';
import { WorkspaceCard, type WorkspaceCardTone } from '@/design-system/components/WorkspaceCard';
import { Clock } from '@/components/Icons';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import {
  formatWaitingShort,
  priorityTierOf,
  queuePosition,
  summarizePriorityQueue,
  tierMeta,
  waitingSince,
  type PriorityTone,
} from '@/lib/receiving/scan-priority';
import { useScannedPriorityQueue } from './useScannedPriorityQueue';

const TONE: Record<
  PriorityTone,
  { solid: string; dot: string; tileRing: string; count: string }
> = {
  rose: { solid: 'bg-rose-600 text-white', dot: 'bg-rose-500', tileRing: 'ring-rose-300', count: 'text-rose-700' },
  amber: { solid: 'bg-amber-500 text-white', dot: 'bg-amber-500', tileRing: 'ring-amber-300', count: 'text-amber-800' },
  blue: { solid: 'bg-blue-600 text-white', dot: 'bg-blue-500', tileRing: 'ring-blue-300', count: 'text-blue-700' },
  violet: { solid: 'bg-violet-600 text-white', dot: 'bg-violet-500', tileRing: 'ring-violet-300', count: 'text-violet-700' },
  gray: { solid: 'bg-gray-700 text-white', dot: 'bg-gray-400', tileRing: 'ring-gray-300', count: 'text-gray-700' },
};

const CARD_TONE: Record<PriorityTone, WorkspaceCardTone> = {
  rose: 'red',
  amber: 'orange',
  blue: 'blue',
  violet: 'violet',
  gray: 'gray',
};

export function TriagePriorityPanel({ row }: { row: ReceivingLineRow }) {
  const { data: rows, isLoading } = useScannedPriorityQueue();
  const queue = rows ?? [];

  const summary = useMemo(() => summarizePriorityQueue(queue), [queue]);
  const position = useMemo(() => queuePosition(queue, row.id), [queue, row.id]);

  const focusKey = priorityTierOf(row);
  const focusMeta = tierMeta(focusKey);
  const focusTone = TONE[focusMeta.tone];
  const waitAt = waitingSince(row);

  return (
    <WorkspaceCard
      label="Triage priority"
      tone={CARD_TONE[focusMeta.tone]}
      actions={
        position ? (
          <span className="tabular-nums text-caption font-black text-gray-500">
            #{position.index} <span className="font-bold text-gray-400">of {position.total}</span>
          </span>
        ) : null
      }
    >
      {/* Focus header — the open carton's standing in the queue. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-micro font-black uppercase tracking-wide ${focusTone.solid}`}
        >
          {focusMeta.label}
        </span>
        {waitAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-micro font-bold text-gray-600">
            <Clock className="h-3.5 w-3.5 text-gray-400" />
            Waiting {formatWaitingShort(waitAt)}
          </span>
        ) : null}
      </div>

      {/* Queue overview — per-tier backlog health. */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[3.25rem] animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : summary.tiers.length === 0 ? (
          <p className="py-1 text-center text-caption text-gray-400">
            Nothing waiting to unbox.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {summary.tiers.map((t) => {
              const tone = TONE[t.tone];
              const isFocus = t.key === focusKey;
              return (
                <div
                  key={t.key}
                  className={`rounded-lg bg-white px-2.5 py-2 ring-1 ring-inset ${
                    isFocus ? `${tone.tileRing} ring-2` : 'ring-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                    <span className="truncate text-mini font-black uppercase tracking-wide text-gray-500">
                      {t.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <span className={`tabular-nums text-lg font-black leading-none ${tone.count}`}>
                      {t.count}
                    </span>
                    {t.oldestAt ? (
                      <span className="tabular-nums text-mini font-bold text-gray-400">
                        {formatWaitingShort(t.oldestAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WorkspaceCard>
  );
}

export default TriagePriorityPanel;
