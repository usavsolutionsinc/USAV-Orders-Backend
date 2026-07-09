/**
 * Serial Number Journey — pure helpers shared by the embeddable
 * {@link SerialJourneySection} and the Operations ▸ History record view.
 *
 * Nothing here touches the DB or React: it builds the focused-journey query
 * filters, the deep-link into History mode, and exports (CSV string + printable
 * HTML) from the already-merged {@link TimelineItem}[] the timeline renders. The
 * heavy lifting (5-spine merge, adapters, idempotent event spine) is untouched —
 * this only surfaces what already exists.
 *
 * The `build*` functions are pure (no `window`, deterministic given `exportedAt`)
 * so they unit-test DB-free; the `download*` / `print*` functions are the thin
 * browser-side side-effects.
 */

import { format, parseISO } from 'date-fns';
import type { TimelineItem } from '@/lib/timeline/types';
// Type-only import: the URL-state module is `'use client'`, but a type import is
// erased at build time, so this stays a server-safe pure module.
import type { JourneyUrlFilters } from '@/components/sidebar/operations/useOperationsTimelineUrlState';

/** The focused-journey filter snapshot for a single serial (dim=serial). */
export function serialJourneyFilters(serial: string): JourneyUrlFilters {
  return {
    dim: 'serial',
    order: null,
    serial: serial.trim() || null,
    tracking: null,
    from: null,
    until: null,
    stations: [],
    types: [],
    status: null,
    staffId: null,
    sources: [],
    q: null,
  };
}

/**
 * Deep link into Operations ▸ History focused on this serial — the full-page
 * journey surface (mirrors the params `useOperationsTimelineUrlState` writes).
 */
export function buildSerialJourneyHref(serial: string): string {
  const p = new URLSearchParams();
  p.set('mode', 'history');
  p.set('dim', 'serial');
  const v = serial.trim();
  if (v) p.set('serial', v);
  return `/operations?${p.toString()}`;
}

// ── Export: CSV ──────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'Timestamp (ISO)',
  'Local time',
  'Event',
  'Detail',
  'Actor',
  'Reference',
] as const;

/** RFC-4180 cell: quote when it contains a comma/quote/newline; double inner quotes. */
function csvCell(value: string | null | undefined): string {
  const s = (value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localTime(at: string | null): string {
  if (!at) return '';
  try {
    return format(parseISO(at), 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return at;
  }
}

function refCell(item: TimelineItem): string {
  return item.ref ? `${item.ref.kind}:${item.ref.value}` : '';
}

/**
 * Build a CSV of a record's journey from the merged timeline rows the UI shows.
 * `recordLabel` is the order/serial/tracking value the journey is anchored to.
 * `exportedAt` is injectable for deterministic tests (defaults to now).
 */
export function buildJourneyCsv(
  recordLabel: string,
  items: TimelineItem[],
  exportedAt: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push(`Journey,${csvCell(recordLabel)}`);
  lines.push(`Exported,${csvCell(exportedAt.toISOString())}`);
  lines.push(`Events,${items.length}`);
  lines.push('');
  lines.push(CSV_HEADERS.join(','));
  for (const it of items) {
    lines.push(
      [
        csvCell(it.at),
        csvCell(localTime(it.at)),
        csvCell(it.title),
        csvCell(it.subtitle),
        csvCell(it.actor),
        csvCell(refCell(it)),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function fileSlug(recordLabel: string): string {
  return recordLabel.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
}

/** Browser: download the journey as a CSV file. No-op server-side. */
export function downloadJourneyCsv(recordLabel: string, items: TimelineItem[]): void {
  if (typeof window === 'undefined') return;
  const csv = buildJourneyCsv(recordLabel, items);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `serial-journey-${fileSlug(recordLabel)}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Export: print → PDF (browser "Save as PDF") ──────────────────────────────

function escHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the printable HTML document for a journey. Pure (no `window`), so it is
 * testable; {@link printJourney} is the side-effecting wrapper.
 */
export function buildJourneyPrintHtml(
  recordLabel: string,
  items: TimelineItem[],
  exportedAt: Date = new Date(),
): string {
  const rows = items
    .map(
      (it) => `<tr>
        <td>${escHtml(localTime(it.at))}</td>
        <td>${escHtml(it.title)}</td>
        <td>${escHtml(it.subtitle ?? '')}</td>
        <td>${escHtml(it.actor ?? '')}</td>
        <td>${escHtml(refCell(it))}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Serial journey — ${escHtml(recordLabel)}</title>
<style>
  body { font: 12px -apple-system, Segoe UI, Roboto, sans-serif; color: #111827; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
  td:first-child { white-space: nowrap; color: #374151; }
</style></head>
<body>
  <h1>Serial journey — ${escHtml(recordLabel)}</h1>
  <div class="meta">${items.length} event${items.length === 1 ? '' : 's'} · exported ${escHtml(
    exportedAt.toISOString(),
  )}</div>
  <table>
    <thead><tr><th>Local time</th><th>Event</th><th>Detail</th><th>Actor</th><th>Reference</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;
}

/** Browser: open the journey in a print window (→ Save as PDF). No-op server-side. */
export function printJourney(recordLabel: string, items: TimelineItem[]): void {
  if (typeof window === 'undefined') return;
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return;
  w.document.write(buildJourneyPrintHtml(recordLabel, items));
  w.document.close();
  w.focus();
  w.print();
}
