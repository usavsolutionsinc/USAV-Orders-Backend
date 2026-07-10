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
 * One field-level before→after change, rendered as a muted `key: before → after`
 * line under the row (the audit-diff slot). Produced by `diffChanges`
 * (`src/lib/timeline/audit-diff.ts`) from an audit row's before/after snapshots.
 * `before`/`after` are pre-formatted display strings (or null = absent).
 */
export interface TimelineChange {
  key: string;
  before: string | null;
  after: string | null;
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
 * A photo attached to an event, rendered by {@link EventTimeline} as an inline
 * thumbnail strip (unbox / testing captures on a unit timeline). The renderer
 * shows `thumbUrl` and links out to `fullUrl`; it never fetches — the section
 * component pre-attaches the media. Omit ⇒ no media block (existing consumers
 * are unaffected).
 */
export interface TimelineMedia {
  photoId: number;
  thumbUrl: string;
  fullUrl: string;
  caption?: string;
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
  /**
   * Field-level before→after diff (audit rows), rendered as a small muted list
   * under the subtitle. Populated only for edit-style audit events where BOTH
   * snapshots are present and the caller is permitted to see them — see
   * `diffChanges` and the route-level redaction in the operations journey. Omit
   * ⇒ no diff block (every existing consumer is unaffected).
   */
  changes?: TimelineChange[];
  /** Identifier shown as a last-4 CopyChip under the title (tracking/serial/…). */
  ref?: TimelineRef;
  /** Actor name — rendered after the time as "· {actor}". */
  actor?: string;
  /** Optional pills below the title (signed-by, exception, …). */
  badges?: TimelineItemBadge[];
  /** Optional leading glyph rendered in place of the dot. */
  icon?: React.ReactNode;
  /**
   * Inline photo thumbnails for this event (unbox / testing captures). Rendered
   * as a horizontal thumbnail strip under the row; omit ⇒ no media block. The
   * adapter attaches these — {@link EventTimeline} never fetches.
   */
  media?: TimelineMedia[];
  /**
   * The adapter's raw source event-type string (e.g. `inventory_events.event_type`
   * — 'SHIPPED', 'RETURNED', …), when the source spine has one. Deliberately
   * NOT domain vocabulary the renderer or a generic consumer should switch on
   * — {@link EventTimeline} never reads this field. It exists so a specific,
   * already-domain-aware merge/section component (e.g. `SerialJourneySection`
   * counting a serial's ship/return round trips) can key off a stable enum
   * value instead of pattern-matching the display `title` string, which is
   * free to change without warning. Only adapters backed by a real event-type
   * enum set it (`inventoryEventsToTimeline`, `opsEventsToTimeline`); the
   * others (SAL activity types, audit actions, carrier status categories,
   * warranty events) leave it undefined.
   */
  sourceEventType?: string;
}
