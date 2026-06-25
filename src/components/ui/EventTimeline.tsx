'use client';

import { format, parseISO } from 'date-fns';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import type { TimelineItem, TimelineTone, TimelineRef, TimelineGroupKey } from '@/lib/timeline/types';
import { TIMELINE_OTHER_BAND_KEY } from '@/lib/timeline/types';
import {
  TrackingChip,
  SerialChip,
  FnskuChip,
  OrderIdChip,
  SkuScanRefChip,
  getLast4,
} from '@/components/ui/CopyChip';

/**
 * Shared, domain-agnostic event timeline — the vertical day-banded trail used by
 * detail panels across the app (carrier events, order tracking/label events,
 * receiving/tech/warranty/repair history…). It renders generic {@link TimelineItem}s;
 * each domain provides a `*ToTimeline` adapter (`src/lib/timeline/*`) — panels
 * never hand-roll a timeline.
 *
 * Visual language: Linear/Notion/Shopify — a quiet fading rail, precise tone dots
 * (the only color), refined type hierarchy, a hover row, and a restrained
 * staggered reveal. Identifiers reuse the app-wide {@link CopyChip} family
 * (last-4 + copy-on-click), so a tracking/serial in the timeline behaves exactly
 * like the same id everywhere else.
 */

const DOT_TONE: Record<TimelineTone, string> = {
  default: 'bg-blue-500',
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  muted: 'bg-gray-300',
};

// Soft static halo behind the latest dot (calm, not an animated ping).
const DOT_HALO: Record<TimelineTone, string> = {
  default: 'rgba(59,130,246,0.16)',
  info: 'rgba(59,130,246,0.16)',
  success: 'rgba(16,185,129,0.18)',
  warning: 'rgba(245,158,11,0.18)',
  danger: 'rgba(244,63,94,0.18)',
  muted: 'rgba(148,163,184,0.18)',
};

const BADGE_TONE: Record<TimelineTone, string> = {
  default: 'bg-gray-100 text-gray-600',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  muted: 'bg-gray-100 text-gray-600',
};

type Density = 'comfortable' | 'compact';
const DENSITY: Record<Density, { pb: string; day: string; dotTop: string }> = {
  comfortable: { pb: 'pb-4', day: 'mt-5 first:mt-0', dotTop: 'top-[3px]' },
  compact: { pb: 'pb-3', day: 'mt-4 first:mt-0', dotTop: 'top-[2px]' },
};

function fmt(value: string | null | undefined, pattern: string): string {
  if (!value) return '—';
  try {
    return format(typeof value === 'string' ? parseISO(value) : value, pattern);
  } catch {
    return value;
  }
}

/** Short kind label shown before the identifier chip in the serial-grouped view. */
const REF_KIND_LABEL: Record<TimelineRef['kind'], string> = {
  serial: 'Serial',
  tracking: 'Tracking',
  fnsku: 'FNSKU',
  sku: 'SKU',
  id: 'Order',
};

/** Render an identifier through the shared CopyChip family (last-4 + copy). */
function TimelineRefChip({ refItem }: { refItem: TimelineRef }) {
  const v = String(refItem.value || '').trim();
  if (!v) return null;
  switch (refItem.kind) {
    case 'tracking':
      return <TrackingChip value={v} display={getLast4(v)} dense fitDisplayWidth />;
    case 'serial':
      return <SerialChip value={v} width="w-auto" dense />;
    case 'fnsku':
      return <FnskuChip value={v} width="w-auto" />;
    case 'sku':
      return <SkuScanRefChip value={v} display={getLast4(v)} dense />;
    case 'id':
    default:
      return <OrderIdChip value={v} display={v} dense />;
  }
}

/**
 * How the rows are grouped:
 *   • `time`   — chronological day bands ("order-based" view: the merged trail in
 *                time order — the default everywhere).
 *   • `serial` — one band per identifier (serial/tracking/sku/order id), each
 *                holding that unit's events in time order ("serial-based" view).
 *                Rows with no `ref` collapse under a single "Order events" band so
 *                nothing is dropped.
 *
 * The data already carries a per-row {@link TimelineRef} from every adapter, so
 * the serial↔order toggle is a pure presentation switch over the same items —
 * no second fetch, no second component.
 */
export type TimelineGroupMode = 'time' | 'serial';

export interface EventTimelineProps {
  items: TimelineItem[];
  emptyMessage?: string;
  /** Group rows under "EEE, MMM d" day bands (default true). Ignored when
   *  `groupMode === 'serial'` (serial bands replace day bands). */
  groupByDay?: boolean;
  /** Ring + highlight the first (latest) row (default true). */
  highlightLatest?: boolean;
  /** Vertical rhythm — `compact` for sidebars, `comfortable` (default) for panels. */
  density?: Density;
  /** Identifier grouping (the serial↔order toggle). Default `time`. */
  groupMode?: TimelineGroupMode;
  /**
   * Override how rows bucket into bands when `groupMode === 'serial'`. Defaults
   * to the row's own `ref` (`kind:value`). Lets a caller group by a chosen
   * dimension (order / serial / tracking) without mutating each row's ref/chip —
   * e.g. the operations journey buckets a unit-lifecycle row under its *order*
   * band while the row still shows its *serial* chip. Omit ⇒ today's behavior.
   */
  groupKeyOf?: (item: TimelineItem) => TimelineGroupKey | null;
}

/** A serial-view band: an identifier header + that identifier's rows. */
interface SerialGroup {
  key: string;
  ref: TimelineRef | null;
  label: string;
  items: TimelineItem[];
}

/**
 * Bucket items by their `ref` identifier, preserving the incoming (sorted) order
 * both for the rows inside a band and for the bands themselves (first-seen wins),
 * so the serial view stays newest-first like the time view. Ref-less rows fall
 * into one trailing "Order events" band rather than vanishing.
 */
function groupBySerial(
  items: TimelineItem[],
  groupKeyOf?: (item: TimelineItem) => TimelineGroupKey | null,
): SerialGroup[] {
  const map = new Map<string, SerialGroup>();
  const NO_REF = TIMELINE_OTHER_BAND_KEY;
  for (const it of items) {
    // The band a row belongs to is, by default, its own ref identifier. A caller
    // can override this with `groupKeyOf` to group by a chosen dimension
    // (order / serial / tracking) without mutating each row's own ref/chip.
    const gk =
      groupKeyOf?.(it) ??
      (it.ref ? { key: `${it.ref.kind}:${it.ref.value}`, label: it.ref.value, ref: it.ref } : null);
    const key = gk?.key ?? NO_REF;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        ref: gk?.ref ?? null,
        label: gk?.label ?? 'Order events',
        items: [],
      };
      map.set(key, group);
    }
    group.items.push(it);
  }
  // Keep the ref-less "Order events" band last so identifiers lead the view.
  const groups = [...map.values()];
  groups.sort((a, b) => Number(a.key === NO_REF) - Number(b.key === NO_REF));
  return groups;
}

export function EventTimeline({
  items,
  emptyMessage = 'No events yet.',
  groupByDay = true,
  highlightLatest = true,
  density = 'comfortable',
  groupMode = 'time',
  groupKeyOf,
}: EventTimelineProps) {
  const reduce = useReducedMotion();
  const d = DENSITY[density];

  if (items.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center px-4 text-center text-caption font-medium text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  // Serial-based view: render one EventTimeline band per identifier, reusing the
  // exact same row rendering (time grouping off inside a band). This keeps a
  // single timeline primitive — the serial view is the time view, re-bucketed.
  if (groupMode === 'serial') {
    const groups = groupBySerial(items, groupKeyOf);
    return (
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-2 flex items-center gap-2 pl-px">
              <span className="text-mini font-bold uppercase tracking-[0.12em] text-gray-400">
                {g.ref ? `${REF_KIND_LABEL[g.ref.kind]} ` : ''}
              </span>
              {g.ref ? (
                <TimelineRefChip refItem={g.ref} />
              ) : (
                <span className="text-mini font-bold uppercase tracking-[0.12em] text-gray-400">
                  {g.label}
                </span>
              )}
              <span className="text-micro font-medium text-gray-300">
                {g.items.length} {g.items.length === 1 ? 'event' : 'events'}
              </span>
            </div>
            <EventTimeline
              items={g.items}
              groupByDay={false}
              highlightLatest={false}
              density={density}
              groupMode="time"
            />
          </div>
        ))}
      </div>
    );
  }

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.035, delayChildren: 0.02 } },
  };
  const row: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.2 } } }
    : {
        hidden: { opacity: 0, y: 3 },
        show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: motionBezier.easeOut } },
      };

  return (
    <motion.ol
      className="relative"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Fading hairline rail — soft at both ends (Linear touch), so it never
          hard-stops against the first/last dot. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[5px] top-1 bottom-1 w-px bg-gray-200"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent)',
        }}
      />

      {items.map((item, i) => {
        const time = fmt(item.at, 'h:mma').toLowerCase();
        const dayKey = fmt(item.at, 'EEE, MMM d');
        const showDay = groupByDay && (i === 0 || dayKey !== fmt(items[i - 1]?.at, 'EEE, MMM d'));
        const isLatest = highlightLatest && i === 0;
        const tone = item.tone ?? 'info';

        return (
          <motion.li key={item.id} variants={row} className="relative pl-5">
            {showDay ? (
              <div
                className={`${d.day} mb-1.5 pl-px text-mini font-bold uppercase tracking-[0.12em] text-gray-400`}
              >
                {dayKey}
              </div>
            ) : null}

            <div className={`relative ${d.pb} last:pb-0`}>
              {/* Dot / icon — the only color in the row. */}
              {item.icon ? (
                <span className={`absolute -left-5 ${d.dotTop} flex h-3.5 w-3.5 items-center justify-center text-gray-400`}>
                  {item.icon}
                </span>
              ) : (
                <span
                  className={`absolute -left-[18px] ${d.dotTop} h-[9px] w-[9px] rounded-full ring-[3px] ring-white ${DOT_TONE[tone]}`}
                  style={isLatest ? { boxShadow: `0 0 0 4px ${DOT_HALO[tone]}` } : undefined}
                />
              )}

              {/* Hover surface — bleeds slightly past the text, never under the dot. */}
              <div className="-mx-2 rounded-lg px-2 py-0.5 transition-colors duration-150 hover:bg-gray-50/80">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`text-caption tracking-tight ${
                      isLatest ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-micro font-medium tabular-nums text-gray-400">
                    {time}
                    {item.actor ? <span className="text-gray-300"> · </span> : null}
                    {item.actor ? <span className="text-gray-500">{item.actor}</span> : null}
                  </span>
                </div>

                {item.subtitle ? (
                  <div className="mt-0.5 text-micro font-medium tabular-nums text-gray-400">
                    {item.subtitle}
                  </div>
                ) : null}

                {item.ref ? (
                  <div className="mt-1 -ml-1.5">
                    <TimelineRefChip refItem={item.ref} />
                  </div>
                ) : null}

                {item.badges?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.badges.map((badge, bi) => (
                      <span
                        key={bi}
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-eyebrow font-bold ${BADGE_TONE[badge.tone]}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </motion.li>
        );
      })}
    </motion.ol>
  );
}
