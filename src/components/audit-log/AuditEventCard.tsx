'use client';

/**
 * Shared timeline-event card for the audit-log sections (Tech, Packing).
 *
 * Phase 2 of the audit-trail anchoring effort (docs/audit-trail-anchor-plan.md):
 * the Tech and Packing sections previously each carried a near-identical
 * `EventRow` + `KIND_TONE` + `kindLabel` + `CenterMessage`. Those are
 * consolidated here so the kind→tone vocabulary is single-sourced.
 *
 * The Receiving section keeps its own richer renderer (per-kind icons,
 * workflow badges, carton/line grouping) — it intentionally does NOT use this
 * card.
 */

import { Camera, FileText, User as UserIcon } from '@/components/Icons';
import { formatPSTTimestamp } from '@/utils/date';

/** Minimal event shape both TechEvent and PackingEvent satisfy structurally. */
export interface AuditTimelineEvent {
  id: string;
  occurred_at: string;
  source: string;
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  serial_number?: string | null;
  sku?: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatPSTTimestamp(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * kind → chip tone. Union across the audit sections: tech/serial verbs, pack
 * verbs, and the inventory_events lifecycle spine (receiving → testing →
 * outbound). Unknown kinds fall back to slate in {@link AuditEventCard}.
 */
export const KIND_TONE: Record<string, string> = {
  // Tech / serial
  SERIAL_TESTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SERIAL_ADDED: 'bg-sky-50 text-sky-700 ring-sky-200',
  FNSKU_SCANNED: 'bg-amber-50 text-amber-700 ring-amber-200',
  FBA_READY: 'bg-violet-50 text-violet-700 ring-violet-200',
  // Packing
  PACK_COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PACK_SCAN: 'bg-sky-50 text-sky-700 ring-sky-200',
  TRACKING_SCANNED: 'bg-sky-50 text-sky-700 ring-sky-200',
  PHOTO_ADDED: 'bg-violet-50 text-violet-700 ring-violet-200',
  // Lifecycle spine (inventory_events): receiving → testing
  RECEIVED: 'bg-sky-50 text-sky-700 ring-sky-200',
  TEST_START: 'bg-amber-50 text-amber-700 ring-amber-200',
  TEST_PASS: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  TEST_FAIL: 'bg-rose-50 text-rose-700 ring-rose-200',
  PUTAWAY: 'bg-violet-50 text-violet-700 ring-violet-200',
  MOVED: 'bg-surface-sunken text-text-muted ring-border-soft',
  // Lifecycle spine: outbound
  ALLOCATED: 'bg-sky-50 text-sky-700 ring-sky-200',
  RELEASED: 'bg-surface-sunken text-text-muted ring-border-soft',
  PICKED: 'bg-amber-50 text-amber-700 ring-amber-200',
  PACKED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  LABELED: 'bg-violet-50 text-violet-700 ring-violet-200',
  STAGED: 'bg-sky-50 text-sky-700 ring-sky-200',
  SHIPPED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function AuditEventCard({ event }: { event: AuditTimelineEvent }) {
  const tone = KIND_TONE[event.kind] ?? 'bg-surface-sunken text-text-muted ring-border-soft';
  // serial/sku may be top-level (Tech) or tucked into detail (Packing spine rows).
  const serial = event.serial_number ?? pickString(event.detail?.serial_number);
  const sku = event.sku ?? pickString(event.detail?.sku);
  const photoUrl = event.source === 'photo' ? pickString(event.detail?.url) : null;

  return (
    <div className="rounded-xl border border-border-soft bg-surface-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wider ring-1 ${tone}`}
            >
              {kindLabel(event.kind)}
            </span>
            {event.station && <span className="text-micro text-text-soft">{event.station}</span>}
          </div>
          <div className="mt-1 flex items-center gap-1 text-caption text-text-soft">
            <UserIcon className="h-3 w-3" />
            {event.actor_name ?? (event.actor_staff_id ? `#${event.actor_staff_id}` : 'System')}
          </div>
          {(serial || sku) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-text-soft">
              {serial && (
                <span className="inline-flex items-center gap-1 font-mono font-semibold text-text-muted">
                  <FileText className="h-3 w-3" />
                  {serial}
                </span>
              )}
              {sku && <span>SKU: {sku}</span>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-micro text-text-faint">{fmtTime(event.occurred_at)}</div>
      </div>

      {event.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-label text-text-muted">
          {event.notes}
        </p>
      )}

      {photoUrl && (
        <div className="mt-2 flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-violet-600" />
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all text-caption font-semibold text-violet-700 hover:underline"
          >
            View photo
          </a>
        </div>
      )}

      {(event.before || event.after) && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-canvas p-2 text-micro text-text-muted">
          {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditCenterMessage({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className={`text-center text-label ${tone === 'error' ? 'text-rose-600' : 'text-text-faint'}`}>
        {label}
      </p>
    </div>
  );
}
