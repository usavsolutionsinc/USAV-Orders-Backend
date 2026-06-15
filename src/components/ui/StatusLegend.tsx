'use client';

import { Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/** Minimal shape a legend needs from a state-meta map (dot color + tooltip copy). */
export interface StatusLegendMeta {
  label: string;
  description: string;
  /** Tailwind bg class for the status dot. */
  dot: string;
}

/** One chip in the legend. `fold` rolls a second state's count into this one. */
export interface StatusLegendItem<K extends string = string> {
  state: K;
  /** Short uppercase label shown next to the dot. */
  short: string;
  /** Optional second state whose count is added to this chip's. */
  fold?: K;
}

/**
 * Compact "dot-color → meaning" legend that doubles as live counts — one wrapped
 * chip strip (dot + short label + count) shared by BOTH the outbound (shipped)
 * and pre-dock (unshipped) status models. Each mode passes its own `meta` map +
 * `items` subset, so the two legends render identically while showing only the
 * states reachable in that mode. Mounting it adds no fetch; counts are computed
 * by the caller from the table's existing query.
 */
export function StatusLegend<K extends string>({
  items,
  meta,
  counts,
  isFetching = false,
  activeState = null,
  onSelectState,
}: {
  items: StatusLegendItem<K>[];
  meta: Record<K, StatusLegendMeta>;
  counts: Record<K, number>;
  isFetching?: boolean;
  /** When `onSelectState` is set, chips become quiet toggle filters; this is the lit one. */
  activeState?: K | null;
  /** Click a chip to filter the table to that state (click the lit one again to clear). */
  onSelectState?: (state: K) => void;
}) {
  const interactive = Boolean(onSelectState);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-gray-50/70 px-3 py-2 ring-1 ring-inset ring-gray-100">
      {items.map(({ state, short, fold }) => {
        const m = meta[state];
        const value = counts[state] + (fold ? counts[fold] : 0);
        const active = activeState === state;
        // Dimming the un-selected chips when a filter is live keeps the lit one
        // unmistakable without adding loud color — true to the flat/quiet system.
        const dimmed = interactive && activeState != null && !active;
        const inner = (
          <>
            <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot} ${dimmed ? 'opacity-40' : ''}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? 'text-gray-900' : 'text-gray-500'} ${dimmed ? 'opacity-60' : ''}`}>{short}</span>
            <span className={`text-xs font-black tabular-nums ${active ? 'text-gray-900' : 'text-gray-900'} ${dimmed ? 'opacity-60' : ''}`}>{value}</span>
          </>
        );
        return (
          <HoverTooltip
            key={state}
            label={`${m.label} — ${m.description}${interactive ? (active ? ' · click to clear' : ' · click to filter') : ''}`}
            className="inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
          >
            {interactive ? (
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelectState?.(state)}
                className={`-mx-0.5 inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors ${
                  active ? 'bg-white ring-1 ring-gray-300 shadow-sm' : 'hover:bg-gray-100'
                }`}
              >
                {inner}
              </button>
            ) : (
              <span className="inline-flex cursor-help items-center gap-1.5">{inner}</span>
            )}
          </HoverTooltip>
        );
      })}
      {isFetching ? <Loader2 className="ml-auto h-3 w-3 animate-spin text-blue-400" /> : null}
    </div>
  );
}
