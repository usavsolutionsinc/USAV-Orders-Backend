/**
 * Triage unfound exception context (Initiative B3).
 *
 * Pure, DB-free presentation layer over the EXISTING `tracking_exceptions`
 * feed (`GET /api/tracking-exceptions?domain=receiving&status=open`). An unfound
 * triage carton (`v_unfound_queue` kind=`unmatched_receiving`) is keyed by its
 * `receiving` id; the open receiving tracking-exception for that same id carries
 * the Zoho re-sync state (retry count, last check time, reason, last error). This
 * module indexes those rows by `receiving_id` and turns one into the read-only
 * status dot + tooltip the triage popover shows — so staff can see "Zoho still
 * hasn't synced this PO" without any new server view.
 *
 * Single source of truth for the unfound exception dot tone + label; never inline
 * the tone/label mapping in a component.
 */

/** The subset of a tracking-exception row this module reads (route-shaped). */
export interface ReceivingExceptionRow {
  receiving_id: number | null;
  status: string;
  exception_reason: string | null;
  zoho_check_count: number | null;
  last_zoho_check_at: string | null;
  last_error: string | null;
}

/** Resolved, render-ready context for one carton's open receiving exception. */
export interface ReceivingExceptionContext {
  receivingId: number;
  retryCount: number;
  lastCheckAt: string | null;
  reason: string;
  lastError: string | null;
}

/** Dot tone for the exception — danger when sync is erroring, else waiting. (internal — only used within this module) */
type ExceptionDotTone = 'warning' | 'danger';

/**
 * Tailwind dot fill per tone — mirrors the rail's existing shade-class dots
 * (`workflowStageDot` returns `bg-*-500`), kept consistent so the exception dot
 * reads the same family as the row's primary status dot.
 */
const EXCEPTION_DOT_CLASS: Record<ExceptionDotTone, string> = {
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

/**
 * Index the OPEN receiving exceptions by their `receiving_id`. Resolved /
 * discarded rows and rows with no receiving link are skipped (they carry no
 * actionable "still waiting" signal for the triage carton). When more than one
 * open exception points at the same carton, the first wins (the route already
 * orders open-first, newest-first).
 */
export function indexReceivingExceptions(
  rows: ReadonlyArray<ReceivingExceptionRow>,
): Map<number, ReceivingExceptionContext> {
  const map = new Map<number, ReceivingExceptionContext>();
  for (const r of rows) {
    if (!r || r.status !== 'open') continue;
    const id = Number(r.receiving_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (map.has(id)) continue;
    map.set(id, {
      receivingId: id,
      retryCount: Number.isFinite(Number(r.zoho_check_count)) ? Number(r.zoho_check_count) : 0,
      lastCheckAt: r.last_zoho_check_at ?? null,
      reason: (r.exception_reason || 'not_found').trim() || 'not_found',
      lastError: r.last_error ? String(r.last_error).trim() || null : null,
    });
  }
  return map;
}

/** Erroring sync → danger (rose); otherwise still-retrying → warning (amber). */
export function exceptionDotTone(ctx: ReceivingExceptionContext): ExceptionDotTone {
  return ctx.lastError ? 'danger' : 'warning';
}

/** The dot fill class for a carton's exception context. */
export function exceptionDotClass(ctx: ReceivingExceptionContext): string {
  return EXCEPTION_DOT_CLASS[exceptionDotTone(ctx)];
}

/** Relative-age label for a check timestamp (e.g. "3h", "now", "—"). */
export function exceptionAgeLabel(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/**
 * Human tooltip for the exception dot: what's pending, how many Zoho checks have
 * run, when the last one ran, and the failing-sync error if any.
 */
export function exceptionTooltipLabel(ctx: ReceivingExceptionContext): string {
  const checks = `${ctx.retryCount} ${ctx.retryCount === 1 ? 'check' : 'checks'}`;
  const last = ctx.lastCheckAt ? `last ${exceptionAgeLabel(ctx.lastCheckAt)} ago` : 'not checked yet';
  const head = ctx.lastError
    ? `Zoho sync error — ${checks} · ${last} · ${ctx.lastError}`
    : `Zoho still hasn't synced this PO — ${checks} · ${last}`;
  return `${head} · ${ctx.reason}`;
}
