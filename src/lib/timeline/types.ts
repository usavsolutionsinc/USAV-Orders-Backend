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
  /** Actor name — rendered after the time as "· {actor}". */
  actor?: string;
  /** Optional pills below the title (signed-by, exception, …). */
  badges?: TimelineItemBadge[];
  /** Optional leading glyph rendered in place of the dot. */
  icon?: React.ReactNode;
}
