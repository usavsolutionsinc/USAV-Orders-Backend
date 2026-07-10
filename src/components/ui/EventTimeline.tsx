'use client';

import { useState, type ReactNode } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { motionBezier } from '@/design-system/foundations/motion-framer';
import type { TimelineItem, TimelineTone, TimelineRef, TimelineGroupKey } from '@/lib/timeline/types';
import { TIMELINE_OTHER_BAND_KEY } from '@/lib/timeline/types';
import { ChevronRight } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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
  muted: 'bg-surface-strong',
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
  default: 'bg-surface-sunken text-text-muted',
  info: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-rose-50 text-rose-700',
  muted: 'bg-surface-sunken text-text-muted',
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

/**
 * Relative "2 days ago" label (the 2026-standard glanceable form) used when
 * `richTime` is on. Falls back to the clock time if the value can't be parsed.
 */
function relTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return formatDistanceToNow(parseISO(value), { addSuffix: true });
  } catch {
    return fmt(value, 'h:mma').toLowerCase();
  }
}

/**
 * Full, timezone-aware absolute timestamp for the rich-time hover tooltip. Uses
 * `Intl` (not date-fns `z` tokens, which throw) so the operator's local zone
 * abbreviation is included — e.g. "Fri, Jun 27, 2026, 2:14:09 PM EDT".
 */
function absTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unknown time';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(parseISO(value));
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
      return <SerialChip value={v} width="w-fit max-w-full" dense />;
    case 'fnsku':
      return <FnskuChip value={v} width="w-fit max-w-full" />;
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
  /**
   * Rich timestamps (the 2026-standard form): show **relative** time inline
   * ("2 days ago") with the full, timezone-aware absolute timestamp on hover.
   * Default `false` keeps the terse `h:mma` clock so existing callers (order,
   * tech, warranty timelines) are unaffected; the serial journey opts in.
   */
  richTime?: boolean;
  /**
   * Serial mode only: render each band collapsed behind a chevron header (the
   * latest band opens by default), so a multi-unit record reads as a tidy tree
   * instead of a wall of rows. Default `false` ⇒ today's always-expanded bands,
   * so existing serial-toggle callers are unaffected.
   */
  collapsibleGroups?: boolean;
  /**
   * Serial mode only: replace the default band header (kind label + chip) with a
   * caller-supplied node — e.g. the operations journey's per-serial provenance
   * card (SKU · grade · status · PO). Receives the band; the count/peek chrome
   * stays owned by {@link EventTimeline}.
   */
  renderGroupHeader?: (group: TimelineGroupView) => ReactNode;
  /**
   * Opt-in row activation (Monitor→detail drill). When provided, each row
   * becomes clickable + keyboard-activatable (Enter/Space) and calls this with
   * the row's item — EXCEPT when the click/keypress lands on an inner
   * interactive element (a CopyChip `<button>` or a link), which keeps its own
   * behavior (copy / navigate). Omit ⇒ rows are inert display, exactly as today
   * (every existing consumer is unaffected). Used by the Operations History
   * browse feed to drill a row into that record's Trace.
   */
  onSelectItem?: (item: TimelineItem) => void;
}

/** A serial-view band: an identifier header + that identifier's rows. */
interface SerialGroup {
  key: string;
  ref: TimelineRef | null;
  label: string;
  items: TimelineItem[];
}

/**
 * Public band shape handed to {@link EventTimelineProps.renderGroupHeader} so a
 * caller can render a custom band header without reaching into internals.
 */
export interface TimelineGroupView {
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

/** The built-in serial-band header: kind label + identifier chip + event count. */
function DefaultGroupHeader({ group }: { group: SerialGroup }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-mini font-bold uppercase tracking-[0.12em] text-text-faint">
        {group.ref ? `${REF_KIND_LABEL[group.ref.kind]} ` : ''}
      </span>
      {group.ref ? (
        <TimelineRefChip refItem={group.ref} />
      ) : (
        <span className="text-mini font-bold uppercase tracking-[0.12em] text-text-faint">
          {group.label}
        </span>
      )}
      <span className="text-micro font-medium text-text-faint">
        {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
      </span>
    </div>
  );
}

/** Collapsed-band peek: the latest event's title + relative time, muted. */
function GroupLatestPeek({ items, richTime }: { items: TimelineItem[]; richTime: boolean }) {
  const latest = items[0];
  if (!latest) return null;
  const when = richTime ? relTime(latest.at) : fmt(latest.at, 'h:mma').toLowerCase();
  return (
    <span className="ml-auto hidden min-w-0 shrink items-center gap-1.5 truncate text-micro font-medium text-text-faint sm:flex">
      <span className="truncate">{latest.title}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-text-faint">· {when}</span>
    </span>
  );
}

export function EventTimeline({
  items,
  emptyMessage = 'No events yet.',
  groupByDay = true,
  highlightLatest = true,
  density = 'comfortable',
  groupMode = 'time',
  groupKeyOf,
  richTime = false,
  collapsibleGroups = false,
  renderGroupHeader,
  onSelectItem,
}: EventTimelineProps) {
  const reduce = useReducedMotion();
  const d = DENSITY[density];
  // Explicit open/closed overrides per band (serial mode + collapsibleGroups).
  // Default openness is "first (latest-activity) band open, the rest collapsed";
  // a click writes an override here.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});

  if (items.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center px-4 text-center text-caption font-medium text-text-faint">
        {emptyMessage}
      </div>
    );
  }

  // Serial-based view: render one EventTimeline band per identifier, reusing the
  // exact same row rendering (time grouping off inside a band). This keeps a
  // single timeline primitive — the serial view is the time view, re-bucketed.
  if (groupMode === 'serial') {
    const groups = groupBySerial(items, groupKeyOf);
    const isOpen = (key: string, idx: number): boolean =>
      !collapsibleGroups || (groupOverrides[key] ?? idx === 0);
    const toggle = (key: string, idx: number) =>
      setGroupOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? idx === 0) }));

    return (
      <div className={collapsibleGroups ? 'space-y-1.5' : 'space-y-5'}>
        {groups.map((g, gi) => {
          const open = isOpen(g.key, gi);
          const header = renderGroupHeader ? (
            renderGroupHeader(g)
          ) : (
            <DefaultGroupHeader group={g} />
          );
          const body = (
            <EventTimeline
              items={g.items}
              groupByDay={false}
              highlightLatest={false}
              density={density}
              groupMode="time"
              richTime={richTime}
            />
          );

          // Non-collapsible: today's behavior — header label above the rows.
          if (!collapsibleGroups) {
            return (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-2 pl-px">{header}</div>
                {body}
              </div>
            );
          }

          // Collapsible: a chevron header row; the latest band opens by default,
          // the rest collapse to a one-line "latest event" peek. The toggle is a
          // `role="button"` div (not a <button>) so the header's interactive
          // CopyChips nest validly — chips stopPropagation, so a chip click copies
          // without toggling the band.
          return (
            <div key={g.key} className="rounded-lg">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggle(g.key, gi)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle(g.key, gi);
                  }
                }}
                aria-expanded={open}
                className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                />
                <div className="min-w-0 flex-1">{header}</div>
                {!open ? <GroupLatestPeek items={g.items} richTime={richTime} /> : null}
              </div>
              {open ? <div className="mt-1.5 pl-[18px]">{body}</div> : null}
            </div>
          );
        })}
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
        className="pointer-events-none absolute left-[5px] top-1 bottom-1 w-px bg-surface-strong"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 14px), transparent)',
        }}
      />

      {items.map((item, i) => {
        const time = richTime ? relTime(item.at) : fmt(item.at, 'h:mma').toLowerCase();
        const dayKey = fmt(item.at, 'EEE, MMM d');
        const showDay = groupByDay && (i === 0 || dayKey !== fmt(items[i - 1]?.at, 'EEE, MMM d'));
        const isLatest = highlightLatest && i === 0;
        const tone = item.tone ?? 'info';

        return (
          <motion.li key={item.id} variants={row} className="relative pl-5">
            {showDay ? (
              <div
                className={`${d.day} mb-1.5 pl-px text-mini font-bold uppercase tracking-[0.12em] text-text-faint`}
              >
                {dayKey}
              </div>
            ) : null}

            <div className={`relative ${d.pb} last:pb-0`}>
              {/* Dot / icon — the only color in the row. */}
              {item.icon ? (
                <span className={`absolute -left-5 ${d.dotTop} flex h-3.5 w-3.5 items-center justify-center text-text-faint`}>
                  {item.icon}
                </span>
              ) : (
                <span
                  className={`absolute -left-[18px] ${d.dotTop} h-[9px] w-[9px] rounded-full ring-[3px] ring-white ${DOT_TONE[tone]}`}
                  style={isLatest ? { boxShadow: `0 0 0 4px ${DOT_HALO[tone]}` } : undefined}
                />
              )}

              {/* Hover surface — bleeds slightly past the text, never under the dot. */}
              <div
                className={`-mx-2 rounded-lg px-2 py-0.5 transition-colors duration-150 hover:bg-surface-canvas/80${
                  onSelectItem ? ' cursor-pointer' : ''
                }`}
                role={onSelectItem ? 'button' : undefined}
                tabIndex={onSelectItem ? 0 : undefined}
                onClick={
                  onSelectItem
                    ? (e) => {
                        // Let inner chips/links keep their own click (copy / navigate).
                        if ((e.target as HTMLElement).closest('button,a')) return;
                        onSelectItem(item);
                      }
                    : undefined
                }
                onKeyDown={
                  onSelectItem
                    ? (e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if ((e.target as HTMLElement).closest('button,a')) return;
                        e.preventDefault();
                        onSelectItem(item);
                      }
                    : undefined
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`text-caption tracking-tight ${
                      isLatest ? 'font-bold text-text-default' : 'font-semibold text-text-muted'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-micro font-medium tabular-nums text-text-faint">
                    {richTime ? (
                      <HoverTooltip
                        label={absTimestamp(item.at)}
                        focusable={false}
                        className="cursor-default border-b border-dotted border-border-default"
                      >
                        {time}
                      </HoverTooltip>
                    ) : (
                      time
                    )}
                    {item.actor ? <span className="text-text-faint"> · </span> : null}
                    {item.actor ? <span className="text-text-soft">{item.actor}</span> : null}
                  </span>
                </div>

                {item.subtitle ? (
                  <div className="mt-0.5 text-micro font-medium tabular-nums text-text-faint">
                    {item.subtitle}
                  </div>
                ) : null}

                {item.changes?.length ? (
                  <ul className="mt-1 space-y-0.5">
                    {item.changes.map((c, ci) => (
                      <li key={ci} className="text-micro font-medium text-text-faint">
                        <span className="font-semibold text-text-soft">{c.key}</span>
                        {': '}
                        <span className="text-text-faint">{c.before ?? '—'}</span>
                        <span className="text-text-faint"> → </span>
                        <span className="text-text-muted">{c.after ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
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

                {item.media?.length ? (
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
                    {item.media.map((m) => (
                      <a
                        key={m.photoId}
                        href={m.fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-border-hairline transition-opacity hover:opacity-90"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.thumbUrl}
                          alt={m.caption ?? 'photo'}
                          loading="lazy"
                          className="h-12 w-12 object-cover"
                        />
                      </a>
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
