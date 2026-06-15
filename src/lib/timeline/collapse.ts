import { format, parseISO } from 'date-fns';
import type { TimelineItem } from './types';

/**
 * Collapse runs of consecutive, identical events into a single row.
 *
 * Operational ledgers (esp. SAL tech scans) frequently record the *same* action
 * on the *same* ref by the *same* person several times in a row — e.g. a tech
 * re-scanning the same tracking. On the order timeline these stack up as
 * near-duplicate rows ("Tech scanned 8231" twice) and bury the milestones that
 * matter. We fold an adjacent run (same title + ref + actor + tone) into one row,
 * keep the newest timestamp as the row time, and annotate the count + the time
 * span in the subtitle so nothing is silently dropped.
 *
 * Operates on an already-sorted (newest-first) list; only *adjacent* equals
 * merge, so a tech scan that brackets a different event stays distinct.
 */
function timeOf(at: string | null): string {
  if (!at) return '';
  try {
    return format(parseISO(at), 'h:mma').toLowerCase();
  } catch {
    return '';
  }
}

function signature(item: TimelineItem): string {
  return [item.title, item.ref?.value ?? '', item.actor ?? '', item.tone ?? ''].join('|');
}

export function collapseTimeline(items: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let i = 0;
  while (i < items.length) {
    const head = items[i];
    let j = i + 1;
    while (j < items.length && signature(items[j]) === signature(head)) j++;
    const count = j - i;

    if (count > 1) {
      const oldest = items[j - 1];
      const earliest = timeOf(oldest.at);
      const span = earliest ? `${count}× · earliest ${earliest}` : `${count}×`;
      out.push({
        ...head,
        // Keep the head's own subtitle if it carries one, then append the run.
        subtitle: head.subtitle ? `${head.subtitle} · ${span}` : span,
      });
    } else {
      out.push(head);
    }
    i = j;
  }
  return out;
}
