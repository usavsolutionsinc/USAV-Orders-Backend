import type { ReactNode } from 'react';

export function railRelativeTime(iso: string | null | undefined): string {
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

/** DESC sort key for a feed's `getActivityAt` axis; missing/invalid → 0 (last). */
export function railActivitySortMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export interface SidebarRailRowContext {
  isSelected: boolean;
  isFocused: boolean;
  /** PKG-group chip node (when this row leads a collapsed multi-item group), else null. */
  pkgChip: ReactNode;
}

export interface SidebarRailShellProps<TRow> {
  /** React-query key. */
  queryKey: ReadonlyArray<unknown>;
  /** Fetcher returning the rows directly. */
  fetchFn: () => Promise<TRow[]>;
  /** Optimistic update event ({ id, ...partial }); merged into the matching row. */
  updateEvent?: string;
  /** Optimistic delete event ({ id }); the matching row is dropped immediately. */
  deleteEvent?: string;
  /**
   * Optimistic group-delete event (detail = group id, e.g. a receiving_id).
   * Every row whose `getGroupId` matches is dropped immediately — used when a
   * whole carton/log is removed and all its lines should vanish from the rail.
   */
  deleteGroupEvent?: string;
  /** Events that trigger a full query invalidation. */
  refreshEvents?: string[];
  /**
   * When set, a CustomEvent<'prev' | 'next'> on this name steps the selection to
   * the adjacent rendered row and fires `onSelect` — the wiring behind a detail
   * pane's up/down header chevrons when there's no separate table to drive
   * navigation (Unbox/Triage/Testing workspace header → this rail).
   */
  navigateEvent?: string;

  selectedId: number | null;
  selectedRow?: TRow | null;
  /**
   * Optimistic row pinned at the very top until its real row lands in the feed —
   * e.g. the triage "importing" stub (title = the scanned tracking #), rendered
   * through the SAME row component, then replaced by the resolved row. Deduped by
   * id so it never doubles a row already present.
   */
  leadingRow?: TRow | null;
  limit?: number;
  /**
   * When true (default), a selected row that falls outside the top-N window is
   * hoisted to `rows[0]` (pinned lead) so the active line stays visible. Set
   * FALSE for feeds that must hold a STRICT sort order (e.g. the unbox rail,
   * which must always read top→bottom by `unboxed_at`): the hoist there made a
   * just-received carton shoot to the top and then drop back down as the
   * authoritative refetch settled it into its real `unboxed_at` slot — a
   * jarring bounce. With the pin off, the row simply stays in its sorted
   * position (a freshly-unboxed carton is at the top by `unboxed_at` anyway).
   */
  pinSelectedLead?: boolean;

  eyebrowTitle: string;
  eyebrowSuffix?: string;
  /** Right-aligned eyebrow slot (e.g. a refresh button). Takes precedence over `eyebrowSuffix`. */
  eyebrowAction?: ReactNode;
  emptyText?: string;
  /**
   * When true, selects the first row once data loads if nothing is selected yet.
   * Re-selects when selection is cleared (e.g. switching back to Receive mode).
   */
  autoSelectFirstWhenEmpty?: boolean;
  /** Optional guard — return false to skip auto-select (deep links, wrong mode). */
  canAutoSelectFirst?: () => boolean;
  /**
   * When true, rows cascade in (stagger reveal) the first time the feed loads,
   * and freshly-arriving rows slide in individually. Off by default so callers
   * opt in explicitly.
   */
  staggerReveal?: boolean;
  /**
   * Stagger entrance axis.
   *   - `sidebar` (default) — opacity + y settle; safe in scrolling sidebar rails.
   *   - `rise` — taller y settle for full-width workbench cards.
   *   - `slide` — horizontal scan-bar language; never inside `overflow-y-auto`.
   */
  staggerRevealMotion?: 'slide' | 'rise' | 'sidebar';

  getId: (row: TRow) => number;
  /**
   * Durable RENDER identity, preferred over {@link getId} for the React `key` AND
   * the {@link leadingRow} dedup. Lets an optimistic row (the triage "importing"
   * stub) reconcile to its resolved row IN PLACE — same key → React UPDATE, not
   * unmount+remount — even though its server `id` changes on resolve. Return a
   * client-minted id (e.g. `client_event_id`) that survives the stub→real swap;
   * fall back to a stringified `id` for ordinary rows. Defaults to `getId`.
   */
  getReconcileId?: (row: TRow) => string | number;
  /** Grouping key (e.g. receiving_id). Return null for no grouping. */
  getGroupId?: (row: TRow) => number | null;
  getActivityAt?: (row: TRow) => string | null | undefined;
  /** When true, row clicks + hover preview are suppressed (e.g. triage importing stub). */
  getRowDisabled?: (row: TRow) => boolean;
  onSelect: (row: TRow) => void;
  getStatusDot: (row: TRow) => string;
  /** Hover tooltip for the status dot — e.g. "Received" / "Scanned". */
  getStatusDotLabel?: (row: TRow) => string;

  renderRowMain: (row: TRow, ctx: SidebarRailRowContext) => ReactNode;
  renderPopover?: (
    row: TRow,
    ctx: { groupSize: number; openWorkspace: () => void; dismiss: () => void },
  ) => ReactNode;
}
