import type React from 'react';

/**
 * Semantic color for a timeline dot / badge. The {@link EventTimeline} component
 * owns the tone→class map (single source of truth for timeline colors); callers
 * choose tones, never raw classes.
 */
export type TimelineTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

export interface TimelineItemBadge {
  label: string;
  tone: TimelineTone;
}

/**
 * An identifier attached to an event (tracking #, serial, FNSKU, order/PO id,
 * SKU). The {@link EventTimeline} renders it through the shared `CopyChip`
 * family — last-4 preview, copy-on-click, tone+icon — so timeline ids look and
 * behave exactly like ids everywhere else in the app. Adapters pass the raw
 * value + kind; the chip owns the last-4 formatting.
 */
export type TimelineRefKind = 'tracking' | 'serial' | 'fnsku' | 'id' | 'sku';

export interface TimelineRef {
  value: string;
  kind: TimelineRefKind;
}

/**
 * Describes the band a row belongs to in the serial-grouped view. By default
 * {@link EventTimeline} derives this from each row's own {@link TimelineRef},
 * but a caller can supply a `groupKeyOf` selector to bucket by a chosen
 * dimension (order / serial / tracking) — `key` is the band identity, `label`
 * the fallback text, and `ref` the optional chip rendered in the band header.
 */
export interface TimelineGroupKey {
  key: string;
  label: string;
  ref?: TimelineRef;
}

/**
 * Band key for ref-less / un-grouped rows in the serial-grouped view. The
 * {@link EventTimeline} sorts this band LAST so identified bands lead. A
 * `groupKeyOf` selector can return this key (with its own label) to force rows
 * lacking the chosen grouping dimension into the trailing band instead of
 * fragmenting them into incidental ref bands.
 */
export const TIMELINE_OTHER_BAND_KEY = '__order__';

/**
 * One generic, domain-agnostic event row. Per-domain feed adapters
 * (`src/lib/timeline/*`) map their source — carrier events, audit logs, repair
 * history, … — into `TimelineItem[]`; the {@link EventTimeline} component knows
 * nothing about any domain.
 */
export interface TimelineItem {
  id: string | number;
  /** Event time; the component formats + day-groups by this. */
  at: string | null;
  /** Primary line. */
  title: string;
  /** Dot color (default 'info'). */
  tone?: TimelineTone;
  /** Secondary line (location / detail), rendered muted under the title. */
  subtitle?: string;
  /** Identifier shown as a last-4 CopyChip under the title (tracking/serial/…). */
  ref?: TimelineRef;
  /** Actor name — rendered after the time as "· {actor}". */
  actor?: string;
  /** Optional pills below the title (signed-by, exception, …). */
  badges?: TimelineItemBadge[];
  /** Optional leading glyph rendered in place of the dot. */
  icon?: React.ReactNode;
}
