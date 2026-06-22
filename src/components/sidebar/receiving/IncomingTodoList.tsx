'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, Inbox, Mail, Loader2 } from '@/components/Icons';
import { SearchBar } from '@/components/ui/SearchBar';
import { VerticalSplitStack } from '@/design-system/components/VerticalSplitStack';
import { ScrollPane } from '@/design-system/primitives/ScrollPane';
import { toast } from '@/lib/toast';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';

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

/** Compact "3d", "5h", "12m" age from an ISO timestamp. */
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

/**
 * Searchable to-do list seeded from incoming email order numbers (P1-RCV-01).
 *
 * Pinned in the Incoming sidebar. Each open item is an unmatched shipping email
 * that references an order# but has no PO in the system yet — the first
 * blocking step of the inbound funnel (docs/incoming-tracking-todo-plan.md
 * Tier 0). Operators search the list, then check items off as they're handled;
 * a checked item moves to the collapsible Done group and can be restored.
 *
 * Layout: {@link VerticalSplitStack} — open list grows to fill the sidebar;
 * "Recently done" is collapsible with an optional drag divider when expanded.
 */
export function IncomingTodoList() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
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
    refetchInterval: 180_000,
    staleTime: 30_000,
  });

  const setToggle = useCallback(
    async (id: string, done: boolean) => {
      setPending((prev) => new Set(prev).add(id));
      try {
        const res = await fetch('/api/receiving-lines/incoming/todo', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, done }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Could not update to-do');
        }
        invalidateReceivingFeeds(queryClient);
        await refetch();
        if (done) {
          toast.success('Marked done', {
            action: { label: 'Undo', onClick: () => void setToggle(id, false) },
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not update to-do');
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

  const open = data?.open;
  const doneItems = useMemo(() => data?.done?.items ?? [], [data?.done?.items]);
  const hasDone = doneItems.length > 0;

  const openBadge =
    open != null ? (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-mini font-black tabular-nums text-amber-700">
        {open.count}
      </span>
    ) : null;

  return (
    <VerticalSplitStack
      className="h-full min-h-0 flex-1 bg-white px-1.5 pb-2"
      persistKey="receiving.incoming.todo"
      resizable={hasDone}
      defaultRatio={0.65}
    >
      <VerticalSplitStack.Section
        id="open"
        title={
          <>
            <Mail className="h-3.5 w-3.5 text-amber-500" />
            Email to-do
          </>
        }
        badge={openBadge}
        flex={1}
        minHeight={120}
        disableScroll
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search order #, subject…"
            variant="gray"
            size="compact"
            debounceMs={250}
            className="mb-2 shrink-0"
          />

          {isLoading ? (
            <p className="flex items-center gap-1.5 px-1 py-2 text-caption text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : isError ? (
            <p className="px-1 py-2 text-caption text-rose-500">Could not load the to-do list.</p>
          ) : !open || open.items.length === 0 ? (
            <p className="flex items-center gap-1.5 px-1 py-2 text-caption text-gray-400">
              <Inbox className="h-3.5 w-3.5" />
              {q ? 'No matching emails.' : 'No unmatched order emails — all clear.'}
            </p>
          ) : (
            <ScrollPane>
              <ul className="space-y-1 pr-0.5">
                {open.items.map((item) => (
                  <TodoRow
                    key={item.id}
                    item={item}
                    busy={pending.has(item.id)}
                    onToggle={(d) => void setToggle(item.id, d)}
                    done={false}
                  />
                ))}
                {open.truncated ? (
                  <li className="px-1 py-1 text-mini font-semibold text-gray-400">
                    +{open.count - open.items.length} more — refine the search to narrow.
                  </li>
                ) : null}
              </ul>
            </ScrollPane>
          )}
        </div>
      </VerticalSplitStack.Section>

      {hasDone ? (
        <VerticalSplitStack.Section
          id="done"
          title="Recently done"
          badge={doneItems.length}
          collapsible
          defaultCollapsed
          flex={1}
          minHeight={80}
        >
            <ul className="space-y-1 pr-0.5">
              {doneItems.map((item) => (
                <TodoRow
                  key={item.id}
                  item={item}
                  busy={pending.has(item.id)}
                  onToggle={(d) => void setToggle(item.id, d)}
                  done
                />
              ))}
            </ul>
        </VerticalSplitStack.Section>
      ) : null}
    </VerticalSplitStack>
  );
}

function TodoRow({
  item,
  busy,
  onToggle,
  done,
}: {
  item: TodoItem;
  busy: boolean;
  onToggle: (done: boolean) => void;
  done: boolean;
}) {
  const orders = item.order_numbers?.length ? item.order_numbers.join(', ') : '(no order #)';
  const age = ageLabel(item.scanned_at);
  return (
    <li className="flex items-start gap-2 rounded-lg border border-gray-100 px-2 py-1.5">
      <button
        type="button"
        onClick={() => onToggle(!done)}
        disabled={busy}
        aria-label={done ? 'Restore to to-do' : 'Mark done'}
        title={done ? 'Restore to to-do' : 'Mark done'}
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-50 ${
          done
            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
            : 'border-gray-300 bg-white text-transparent hover:border-emerald-400 hover:text-emerald-400'
        }`}
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
        ) : (
          <Check className="h-3 w-3" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-caption font-black ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}
          >
            {orders}
          </span>
          {age ? (
            <span className="shrink-0 tabular-nums text-mini font-semibold text-gray-400">{age}</span>
          ) : null}
        </div>
        {item.email_subject ? (
          <p className="truncate text-mini text-gray-500" title={item.email_subject}>
            {item.email_subject}
          </p>
        ) : null}
      </div>
      {done ? (
        <button
          type="button"
          onClick={() => onToggle(false)}
          disabled={busy}
          aria-label="Restore"
          title="Restore to to-do"
          className="mt-0.5 shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </li>
  );
}
