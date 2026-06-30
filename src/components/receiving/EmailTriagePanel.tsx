'use client';

/**
 * EmailTriagePanel — the "Email Triage" right-pane view for `/receiving?mode=incoming`.
 *
 * House-archetype note (see `.claude/rules/contextual-display.md`): this is a
 * **Monitor-leaning** surface — the operator *observes* the unmatched-shipping-email
 * worklist and acts-and-clears each row (archive / link-to-PO / reply). It is the
 * single home for the email worklist (it replaced the old sidebar to-do list). It
 * rides in the Incoming right pane *beside* the "Incoming POS" table, toggled from
 * the sidebar by a URL sub-view (`?incview=pos|email`) via {@link IncomingViewSwitcher},
 * and the right pane crossfades between the two through the canonical
 * `framerPresence.workbenchPane` preset (wired in `ReceivingRightPane`). It is **not**
 * a local-state toggle and it does **not** fork a new list primitive — it reads the
 * `/api/receiving-lines/incoming/todo` spine, so the count and rows stay in lockstep
 * with the rest of the inbound funnel.
 *
 * Data: live by default (shared react-query cache, key `['receiving-lines-incoming-todo', q]`).
 * Pass the optional `emails` prop to render a fixed/mock list instead (tests, Storybook,
 * or a future alternate source) — the row shape is the public {@link Email} model.
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Check,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Reply,
  RotateCcw,
} from '@/components/Icons';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import type { HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { SearchBar } from '@/components/ui/SearchBar';
import { ScrollPane } from '@/design-system/primitives/ScrollPane';
import { Button, EmptyState, IconButton } from '@/design-system/primitives';
import { cn } from '@/utils/_cn';
import { toast } from '@/lib/toast';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

// ─────────────────────────────────────────────────────────────────────────────
// Public model — what a consumer (or a mock) hands the panel.
// ─────────────────────────────────────────────────────────────────────────────

/** Triage status chip shown on each row. Derived from the email subject + pile. */
export type EmailTriageTag = 'NEW' | 'RETURN' | 'DELIVERED' | 'TRACKING' | 'DONE';

/** Which right-pane view is showing in Incoming mode (URL `?incview=`). */
export type IncomingView = 'pos' | 'email';

/**
 * One triage row. This is the stable, presentation-ready shape — the live
 * adapter ({@link todoItemToEmail}) maps the API's worklist row into it, and a
 * caller can pass an array of these directly via the `emails` prop.
 */
export interface Email {
  /** Stable row id (the `email_missing_purchase_orders.id`). */
  id: string;
  /** Order number(s) referenced by the email, e.g. `['04-14639-44393']`. */
  orderNumbers: string[];
  /** Email subject — the truncated description line. */
  subject: string | null;
  /** Raw `From:` header (may be `Name <addr@host>`); used for the reply action. */
  from: string | null;
  /** When the email landed, ISO. */
  receivedAt: string | null;
  /** When the row entered the worklist (queue time), ISO. Drives the age label. */
  scannedAt: string;
  /** Status chip. */
  tag: EmailTriageTag;
  /** True once archived/resolved (pile = `done`). */
  done: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// API row → Email adapter (the `/incoming/todo` TodoItem/TodoResponse shape).
// ─────────────────────────────────────────────────────────────────────────────

interface TodoItem {
  id: string;
  order_numbers: string[];
  email_subject: string | null;
  email_from: string | null;
  email_received: string | null;
  scanned_at: string;
  pile: string;
  resolved_at: string | null;
}

interface TodoResponse {
  success: true;
  open: { items: TodoItem[]; count: number; truncated: boolean };
  done: { items: TodoItem[]; truncated: boolean };
}

/**
 * Heuristic status tag from the email subject + pile. The worklist row has no
 * explicit type column, so we classify on the subject the same way an operator
 * would skim it — RETURN/RMA → Return, delivered → Delivered, tracking/shipped →
 * Tracking, otherwise a fresh New. Centralized here so the chip never re-derives
 * its tone per-render elsewhere (source-of-truth discipline).
 */
function deriveTag(subject: string | null, pile: string): EmailTriageTag {
  if (pile === 'done') return 'DONE';
  const s = (subject ?? '').toLowerCase();
  if (/\b(return|rma|refund)\b/.test(s)) return 'RETURN';
  if (/\bdeliver/.test(s)) return 'DELIVERED';
  if (/\b(track|tracking|shipped|shipment|in transit)\b/.test(s)) return 'TRACKING';
  return 'NEW';
}

/** Map one API worklist row into the presentation-ready {@link Email}. */
export function todoItemToEmail(item: TodoItem): Email {
  return {
    id: item.id,
    orderNumbers: item.order_numbers ?? [],
    subject: item.email_subject,
    from: item.email_from,
    receivedAt: item.email_received,
    scannedAt: item.scanned_at,
    tag: deriveTag(item.email_subject, item.pile),
    done: item.pile === 'done',
  };
}

/** Compact "3d" / "5h" / "12m" age from an ISO timestamp. */
function ageLabel(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** `mailto:` for the native reply action — prefer the OS mail client over custom UI. */
function mailtoHref(from: string | null, subject: string | null): string | null {
  if (!from) return null;
  const addr = from.match(/[^<>\s]+@[^<>\s]+/)?.[0] ?? '';
  if (!addr) return null;
  const subj = subject ? `?subject=${encodeURIComponent(`Re: ${subject}`)}` : '';
  return `mailto:${addr}${subj}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data hook — shares the sidebar's react-query cache (same key/endpoint).
// ─────────────────────────────────────────────────────────────────────────────

interface IncomingEmailTodo {
  open: Email[];
  done: Email[];
  /** True backlog count, independent of the display cap (from the server). */
  openCount: number;
  truncatedBy: number;
  isLoading: boolean;
  isError: boolean;
  /** Archive (`done:true`) or restore (`done:false`) — reversible pile move. */
  setDone: (id: string, done: boolean) => Promise<void>;
  /** Ids with an in-flight PATCH (for per-row spinners). */
  pending: Set<string>;
}

/**
 * Live email worklist. Shares one react-query cache entry across the panel and
 * the count pill (same key, no double-fetch when search is empty). `enabled` lets
 * the panel skip the network entirely when a caller supplies `emails` directly.
 */
function useIncomingEmailTodo(search: string, enabled: boolean): IncomingEmailTodo {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const q = search.trim();

  const { data, isLoading, isError, refetch } = useQuery<TodoResponse>({
    queryKey: ['receiving-lines-incoming-todo', q],
    queryFn: async () => {
      const url = q
        ? `/api/receiving-lines/incoming/todo?q=${encodeURIComponent(q)}`
        : '/api/receiving-lines/incoming/todo';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('todo fetch failed');
      return res.json();
    },
    enabled,
    refetchInterval: 180_000,
    staleTime: 30_000,
  });

  const setDone = useCallback(
    async (id: string, done: boolean) => {
      setPending((prev) => new Set(prev).add(id));
      try {
        const res = await fetch('/api/receiving-lines/incoming/todo', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, done }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not update email');
        invalidateReceivingFeeds(queryClient);
        await refetch();
        if (done) {
          toast.success('Archived', {
            action: { label: 'Undo', onClick: () => void setDone(id, false) },
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update email');
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [queryClient, refetch],
  );

  return {
    open: useMemo(() => (data?.open.items ?? []).map(todoItemToEmail), [data?.open.items]),
    done: useMemo(() => (data?.done.items ?? []).map(todoItemToEmail), [data?.done.items]),
    openCount: data?.open.count ?? 0,
    truncatedBy: data?.open.truncated ? (data.open.count - data.open.items.length) : 0,
    isLoading,
    isError,
    setDone,
    pending,
  };
}

/**
 * Standalone count hook for the switcher pill — reuses the same cache entry as
 * the unfiltered list (`q=''`), so it never adds a request.
 */
export function useIncomingEmailCount(): number {
  const { data } = useQuery<TodoResponse>({
    queryKey: ['receiving-lines-incoming-todo', ''],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/todo', { cache: 'no-store' });
      if (!res.ok) throw new Error('todo fetch failed');
      return res.json();
    },
    refetchInterval: 180_000,
    staleTime: 30_000,
  });
  return data?.open.count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmented control: Incoming POS (n) | Email Triage (n)
// ─────────────────────────────────────────────────────────────────────────────

interface IncomingViewSwitcherProps {
  value: IncomingView;
  onChange: (next: IncomingView) => void;
  /** Live "Incoming POS" count (e.g. `useIncomingTableTotal()`). */
  posCount?: number;
  /** Live "Email Triage" count (`useIncomingEmailCount()`). */
  emailCount?: number;
  className?: string;
}

/**
 * The Incoming view toggle pills (label + count + icon), rendered through
 * the shared `HorizontalButtonSlider` `nav` variant — the same primitive every
 * other page's sub-view tabs use, never a hand-rolled segmented control. It is
 * bare on purpose: it lives in the sidebar's `headerRows` slot (one row right
 * beneath the search bar), and `SidebarShell` supplies the 40px band/gutter.
 * Writing the chosen view to the URL (`?incview=`) is the caller's job, keeping
 * this dumb and the selection deep-linkable.
 */
export function IncomingViewSwitcher({
  value,
  onChange,
  posCount,
  emailCount,
  className,
}: IncomingViewSwitcherProps) {
  const items: HorizontalSliderItem[] = [
    { id: 'pos', label: 'Incoming POS', count: posCount, icon: Inbox },
    { id: 'email', label: 'Email Triage', count: emailCount, icon: Mail },
  ];
  return (
    <HorizontalButtonSlider
      items={items}
      value={value}
      onChange={(next) => onChange(next as IncomingView)}
      variant="nav"
      dense
      className={cn('w-full', className)}
      aria-label="Incoming view"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

/** Chip tone per tag — the 3-layer house chip (bg-50 / text-700 / ring-200). */
const TAG_STYLE: Record<EmailTriageTag, { chip: string; label: string }> = {
  NEW: { chip: 'bg-amber-50 text-amber-700 ring-amber-200', label: 'New' },
  RETURN: { chip: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Return' },
  DELIVERED: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Delivered' },
  TRACKING: { chip: 'bg-blue-50 text-blue-700 ring-blue-200', label: 'Tracking' },
  DONE: { chip: 'bg-gray-100 text-gray-500 ring-gray-200', label: 'Done' },
};

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase leading-none tracking-widest ring-1 ring-inset';

const ROW_ACTION_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-50';

const rowMotion = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0 },
};

interface EmailTriageItemProps {
  email: Email;
  selected: boolean;
  busy: boolean;
  onToggleSelect: (id: string) => void;
  onArchive: (email: Email) => void;
  onRestore: (email: Email) => void;
  onLinkTracking: (email: Email) => void;
}

/**
 * One triage row. One-row anatomy: select box → title (order #s) + meta age →
 * subject description + tag chip → trailing quick actions. Selection is
 * background + ring only (never a height shift), matching the house rule.
 */
function EmailTriageItem({
  email,
  selected,
  busy,
  onToggleSelect,
  onArchive,
  onRestore,
  onLinkTracking,
}: EmailTriageItemProps) {
  const tag = TAG_STYLE[email.tag];
  const age = ageLabel(email.scannedAt);
  const orders = email.orderNumbers.length ? email.orderNumbers.join(', ') : '(no order #)';
  const mailto = mailtoHref(email.from, email.subject);

  return (
    <motion.li
      variants={rowMotion}
      className={cn(
        'group flex items-start gap-2 rounded-lg border px-2 py-1.5 transition-colors',
        selected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-inset ring-blue-400'
          : 'border-gray-100 hover:bg-gray-50',
      )}
    >
      {/* Selection checkbox */}
      {/* ds-raw-button: role=checkbox toggle with custom active fill (not a label/icon button) */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? 'Deselect email' : 'Select email'}
        onClick={() => onToggleSelect(email.id)}
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          selected
            ? 'border-blue-500 bg-blue-500 text-white'
            : 'border-gray-300 bg-white text-transparent hover:border-blue-400',
        )}
      >
        <Check className="h-3 w-3" />
      </button>

      <div className="min-w-0 flex-1">
        {/* Title row: order numbers + age */}
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'truncate text-caption font-black',
              email.done ? 'text-gray-400 line-through' : 'text-gray-900',
            )}
          >
            {orders}
          </span>
          {age ? (
            <span className="shrink-0 tabular-nums text-mini font-semibold text-gray-400">{age}</span>
          ) : null}
          <span className={cn(CHIP_CLASS, 'ml-auto shrink-0', tag.chip)}>{tag.label}</span>
        </div>

        {/* Description: truncated subject */}
        {email.subject ? (
          // ds-allow-title: truncation-only title on a non-interactive clipped element
          <p className="mt-0.5 truncate text-mini text-gray-500" title={email.subject}>
            {email.subject}
          </p>
        ) : (
          <p className="mt-0.5 truncate text-mini italic text-gray-400">No subject</p>
        )}

        {/* Quick actions — reveal on hover/focus to keep the row calm. */}
        <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {!email.done ? (
            <>
              <HoverTooltip label="Link tracking to PO" focusable={false}>
                <IconButton
                  type="button"
                  ariaLabel="Link tracking to PO"
                  onClick={() => onLinkTracking(email)}
                  className={ROW_ACTION_CLASS}
                  icon={<Link2 className="h-3.5 w-3.5" />}
                />
              </HoverTooltip>

              <HoverTooltip label={mailto ? 'Reply' : 'No sender to reply to'} focusable={false}>
                <a
                  href={mailto ?? undefined}
                  aria-disabled={!mailto}
                  aria-label="Reply to sender"
                  className={cn(ROW_ACTION_CLASS, !mailto && 'pointer-events-none opacity-40')}
                >
                  <Reply className="h-3.5 w-3.5" />
                </a>
              </HoverTooltip>

              <HoverTooltip label="Archive" focusable={false}>
                <IconButton
                  type="button"
                  ariaLabel="Archive email"
                  disabled={busy}
                  onClick={() => onArchive(email)}
                  className={ROW_ACTION_CLASS}
                  icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                />
              </HoverTooltip>
            </>
          ) : (
            <HoverTooltip label="Restore to triage" focusable={false}>
              <IconButton
                type="button"
                ariaLabel="Restore email to triage"
                disabled={busy}
                onClick={() => onRestore(email)}
                className={ROW_ACTION_CLASS}
                icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              />
            </HoverTooltip>
          )}
        </div>
      </div>
    </motion.li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailTriagePanelProps {
  /**
   * Optional fixed list. When provided the panel renders these rows and skips
   * the live fetch entirely (tests / mocks / a future alternate source). When
   * omitted it reads the live `/api/receiving-lines/incoming/todo` worklist.
   */
  emails?: Email[];
  /**
   * Quick action: link the email's tracking/order to a PO. Defaults to broadcasting
   * an `incoming-attach-tracking` CustomEvent (the sidebar's attach-tracking flow can
   * listen for it) plus a guidance toast — override to drive a real linker.
   */
  onLinkTracking?: (email: Email) => void;
  className?: string;
}

/**
 * Primary export. Drop into the Incoming right pane; the parent crossfades it in
 * against the POS table on `?incview=email`.
 */
export function EmailTriagePanel({ emails, onLinkTracking, className }: EmailTriagePanelProps) {
  const isControlled = emails != null;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const reduceMotion = useReducedMotion();

  const live = useIncomingEmailTodo(search, !isControlled);

  // Resolve the working set from either the controlled prop or the live hook.
  const q = search.trim().toLowerCase();
  const openEmails = useMemo(() => {
    if (!isControlled) return live.open;
    const all = emails!.filter((e) => !e.done);
    if (!q) return all;
    return all.filter(
      (e) =>
        e.orderNumbers.some((o) => o.toLowerCase().includes(q)) ||
        (e.subject ?? '').toLowerCase().includes(q) ||
        (e.from ?? '').toLowerCase().includes(q),
    );
  }, [isControlled, emails, live.open, q]);

  const doneEmails = useMemo(
    () => (isControlled ? emails!.filter((e) => e.done) : live.done),
    [isControlled, emails, live.done],
  );

  const openCount = isControlled ? openEmails.length : live.openCount;
  const isLoading = !isControlled && live.isLoading;
  const isError = !isControlled && live.isError;

  const defaultLinkTracking = useCallback((email: Email) => {
    window.dispatchEvent(
      new CustomEvent('incoming-attach-tracking', {
        detail: { orderNumbers: email.orderNumbers, emailId: email.id },
      }),
    );
    toast.info(`Linking ${email.orderNumbers[0] ?? 'order'} — attach the tracking number to its PO.`);
  }, []);
  const linkTracking = onLinkTracking ?? defaultLinkTracking;

  const archive = useCallback(
    (email: Email) => {
      if (isControlled) return; // mock mode: no mutation
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(email.id);
        return next;
      });
      void live.setDone(email.id, true);
    },
    [isControlled, live],
  );
  const restore = useCallback(
    (email: Email) => {
      if (isControlled) return;
      void live.setDone(email.id, false);
    },
    [isControlled, live],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const archiveSelected = useCallback(() => {
    if (isControlled) return;
    const ids = [...selected];
    setSelected(new Set());
    ids.forEach((id) => void live.setDone(id, true));
  }, [isControlled, selected, live]);

  // One-time stagger on mount; collapses to an instant opacity fade under
  // reduced-motion. Subsequent search/data changes do NOT re-stagger (the
  // container stays mounted), so typing never flickers the list.
  const listMotion = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.01 } } }
    : { hidden: {}, show: { transition: { staggerChildren: 0.025 } } };

  return (
    <section
      className={cn('flex h-full min-h-0 w-full flex-col bg-white', className)}
      aria-label="Email triage"
    >
      {/* Header: eyebrow + live count + search */}
      <div className="shrink-0 space-y-2 border-b border-gray-200 px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-amber-500" />
          <h2 className="text-eyebrow font-black uppercase tracking-widest text-gray-500">Email triage</h2>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-mini font-black tabular-nums text-amber-700">
            {openCount}
          </span>
          <span className="ml-auto text-mini font-semibold text-gray-400">
            {selected.size > 0 ? `${selected.size} selected` : 'Unmatched shipping emails'}
          </span>
        </div>
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search order #, subject, sender…"
          variant="gray"
          size="compact"
          debounceMs={250}
        />
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <p className="flex items-center gap-1.5 px-3 py-3 text-caption text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        ) : isError ? (
          <div className="px-3 py-4">
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption text-rose-600">
              Could not load the email triage list.
            </div>
          </div>
        ) : openEmails.length === 0 && doneEmails.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-3">
            <EmptyState
              icon={<Inbox className="h-7 w-7 text-gray-400" />}
              title={q ? 'No matching emails' : 'Inbox zero'}
              description={
                q
                  ? 'No emails match this search. Clear it to see the full worklist.'
                  : 'Every unmatched shipping email has been triaged — nothing to do here.'
              }
            />
          </div>
        ) : (
          <ScrollPane className="flex-1">
            <div className="space-y-3 px-3 py-2">
              {/* Open worklist */}
              <motion.ul
                className="space-y-1"
                variants={listMotion}
                initial="hidden"
                animate="show"
              >
                {openEmails.map((email) => (
                  <EmailTriageItem
                    key={email.id}
                    email={email}
                    selected={selected.has(email.id)}
                    busy={live.pending.has(email.id)}
                    onToggleSelect={toggleSelect}
                    onArchive={archive}
                    onRestore={restore}
                    onLinkTracking={linkTracking}
                  />
                ))}
                {!isControlled && live.truncatedBy > 0 ? (
                  <li className="px-1 py-1 text-mini font-semibold text-gray-400">
                    +{live.truncatedBy} more — refine the search to narrow.
                  </li>
                ) : null}
              </motion.ul>

              {/* Recently archived */}
              {doneEmails.length > 0 ? (
                <div className="space-y-1">
                  <p className="px-1 text-eyebrow font-black uppercase tracking-widest text-gray-400">
                    Recently archived
                  </p>
                  <ul className="space-y-1">
                    {doneEmails.map((email) => (
                      <EmailTriageItem
                        key={email.id}
                        email={email}
                        selected={false}
                        busy={live.pending.has(email.id)}
                        onToggleSelect={toggleSelect}
                        onArchive={archive}
                        onRestore={restore}
                        onLinkTracking={linkTracking}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </ScrollPane>
        )}

        {/* Bulk action bar — appears only with a selection (live mode). */}
        {selected.size > 0 && !isControlled ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-3 py-2">
            <span className="text-caption font-bold text-gray-700">{selected.size} selected</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="ml-auto"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={<Archive className="h-3.5 w-3.5" />}
              onClick={archiveSelected}
            >
              Archive {selected.size}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default EmailTriagePanel;
