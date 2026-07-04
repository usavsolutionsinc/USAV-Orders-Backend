import type { TimelineItem, TimelineTone } from './types';
import { SIGNAL_KINDS, SURFACE_ENTITY_TYPES } from '@/lib/surfaces/registry';

/**
 * Normalized `entity_signals` row for the timeline (universal-feed Phase 5).
 * A subset of the table — the columns the two history surfaces read.
 */
export interface EntitySignalTimelineRow {
  id: number;
  occurred_at: string | null;
  signal_kind: string;
  entity_type: string;
  entity_id: number;
  reason_code: string | null;
  notes: string | null;
  severity: number | null;
}

/**
 * signal_kind → dot tone. Kinds are the "why" behind an outcome (returns, test
 * fails, receiving exceptions, denials); tone reflects how bad each reads.
 * Unmapped kinds fall back to muted so a new signal_kind still renders.
 */
const SIGNAL_TONE: Record<string, TimelineTone> = {
  return_reason: 'warning',
  warranty_denial: 'danger',
  exception_why: 'warning',
  triage_outcome: 'info',
  test_fail_reason: 'danger',
  buyer_note: 'info',
};

function pretty(s: string): string {
  const t = s.replace(/[._-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Map `entity_signals` rows → {@link TimelineItem}s for the shared
 * `EventTimeline`. Title = the signal-kind label; subtitle carries the
 * reason_code + free-text notes; a muted badge names the anchored entity
 * ("Serial unit #123"). severity ≥ 2 escalates any non-danger tone to danger so
 * a hard failure reads red. The adapter picks the tone; the view stays dumb.
 */
export function entitySignalsToTimeline(rows: EntitySignalTimelineRow[]): TimelineItem[] {
  return rows.map((r) => {
    const kindDef = (SIGNAL_KINDS as Record<string, { label: string } | undefined>)[r.signal_kind];
    const title = kindDef?.label ?? pretty(r.signal_kind);
    let tone = SIGNAL_TONE[r.signal_kind] ?? 'muted';
    if (r.severity != null && r.severity >= 2 && tone !== 'danger') tone = 'danger';

    const entityDef = (SURFACE_ENTITY_TYPES as Record<string, { label: string } | undefined>)[r.entity_type];
    const entityLabel = entityDef?.label ?? r.entity_type;

    const subtitleParts = [r.reason_code, r.notes].filter((v): v is string => !!v && v.trim().length > 0);

    return {
      id: `sig:${r.id}`,
      at: r.occurred_at,
      title,
      tone,
      subtitle: subtitleParts.length ? subtitleParts.join(' — ') : undefined,
      badges: [{ label: `${entityLabel} #${r.entity_id}`, tone: 'muted' as const }],
      sourceEventType: r.signal_kind,
    };
  });
}
