'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ClipboardList } from 'lucide-react';
import { cn } from '@/utils/_cn';
import { useAuth } from '@/contexts/AuthContext';
import { Popover } from '@/design-system/primitives/Popover';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getOrdersChannelName, safeChannelName } from '@/lib/realtime/channels';
import { formatDate } from '@/components/work-orders/types';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

/**
 * HeaderTopWorkOrderChip — P1-WORK-01 acceptance B.
 *
 * Surfaces the single most important work order for the SIGNED-IN operator in
 * the global header. Data + ranking come from /api/work-orders/mine, which
 * reuses the work-orders queue's data source and the shared ranking SoT
 * (compareWorkOrderRows) — so this chip never diverges from the queue order.
 *
 * Additive + self-contained: renders nothing when the operator has no actionable
 * assigned work, so it stays invisible until there's something to surface.
 * Mounted alongside HeaderGoalChip in GlobalHeader (see that file).
 */

interface TopWorkOrder {
  id: string;
  entityType: string;
  entityId: number;
  queueLabel: string;
  title: string;
  subtitle: string;
  recordLabel: string;
  sourcePath: string;
  status: string;
  priority: number;
  deadlineAt: string | null;
  role: 'tester' | 'packer';
}

async function fetchMine(): Promise<{ top: TopWorkOrder | null }> {
  const res = await fetch('/api/work-orders/mine', { cache: 'no-store', credentials: 'include' });
  if (!res.ok) return { top: null };
  return res.json();
}

export function HeaderTopWorkOrderChip() {
  const { user } = useAuth();
  const staffId = user?.staffId ?? null;
  const orgId = user?.organizationId ?? '';
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const queryKey = useMemo(() => ['work-orders', 'mine', staffId] as const, [staffId]);

  const { data } = useQuery({
    queryKey,
    queryFn: fetchMine,
    enabled: !!staffId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Live-refresh when assignments change (assignment popover / queue PATCH
  // publish to the org-wide orders channel).
  const ordersChannel = safeChannelName(() => getOrdersChannelName(orgId));
  const invalidate = () => void queryClient.invalidateQueries({ queryKey });
  useAblyChannel(ordersChannel, 'order.assignments', invalidate, !!ordersChannel && !!staffId);
  useAblyChannel(ordersChannel, 'queue.assignments', invalidate, !!ordersChannel && !!staffId);

  const top = data?.top ?? null;
  if (!staffId || !top) return null;

  const deadlineLabel = top.deadlineAt ? formatDate(top.deadlineAt, 'No deadline') : null;

  return (
    <div className="relative hidden shrink-0 sm:block">
      <HoverTooltip label="Your top work order" asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Your top work order"
          className={cn(
            'ds-raw-button flex max-w-[220px] items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/70 py-0.5 pl-2 pr-1.5 transition-colors hover:bg-indigo-100/70',
            open && 'bg-indigo-100',
          )}
        >
          <ClipboardList className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
          <span className="min-w-0 truncate text-caption font-bold tracking-tight text-indigo-900">
            {top.title}
          </span>
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 text-indigo-400 transition-transform duration-200', open && 'rotate-180')}
          />
        </button>
      </HoverTooltip>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        placement="bottom-start"
        padded={false}
        role="dialog"
        aria-label="Your top work order"
        className="w-[300px]"
      >
        <div className="border-b border-border-hairline px-3.5 py-3">
          <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-indigo-500">
            Your next work order
          </p>
          <p className="mt-1 text-[14px] font-bold leading-tight tracking-tight text-text-default">
            {top.title}
          </p>
          {top.subtitle ? (
            <p className="mt-0.5 truncate text-caption text-text-soft">{top.subtitle}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-eyebrow font-black uppercase tracking-wider text-text-muted">
            {top.queueLabel}
          </span>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-eyebrow font-black uppercase tracking-wider text-indigo-600">
            {top.role}
          </span>
          {deadlineLabel ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-eyebrow font-bold uppercase tracking-wider text-amber-700">
              Due {deadlineLabel}
            </span>
          ) : null}
        </div>
        <div className="border-t border-border-hairline px-3.5 py-2.5">
          <Link
            href={top.sourcePath}
            onClick={() => setOpen(false)}
            className="inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-label font-bold text-white transition-colors hover:bg-indigo-700"
          >
            Open {top.recordLabel}
          </Link>
        </div>
      </Popover>
    </div>
  );
}
