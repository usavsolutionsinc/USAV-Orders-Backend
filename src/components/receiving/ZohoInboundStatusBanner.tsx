'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, RefreshCw, ShieldCheck, Zap } from '@/components/Icons';
import { MetricLineRow, StatusBadge } from '@/design-system';

type ZohoHealthResponse = {
  success: boolean;
  zoho?: {
    requests_per_minute_budget: number;
    configured_headroom: string;
    max_concurrent: number;
    min_spacing_ms: number;
    max_retries: number;
    circuit: {
      isOpen: boolean;
      retryAfterMs: number;
      consecutiveFailures: number;
    };
    limiter: {
      queueSize: number;
      activeCount: number;
      reservoir: number;
    };
  };
  error?: string;
};

function fmtRetry(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds}s`;
}

export function ZohoInboundStatusBanner() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ZohoHealthResponse>({
    queryKey: ['zoho-health'],
    queryFn: async () => {
      const res = await fetch('/api/zoho/health', { cache: 'no-store' });
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/zoho/purchase-orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enqueue: true, per_page: 200, max_pages: 3, max_items: 400, days_back: 7 }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to start Zoho sync');
      }
      return payload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['zoho-health'] });
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    },
  });

  const zoho = data?.zoho;
  const tone = useMemo(() => {
    if (zoho?.circuit.isOpen) {
      return {
        shell: 'border-amber-200 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,251,235,0.92))]',
        text: 'text-amber-900',
        subtext: 'text-amber-700',
        badge: 'bg-amber-200 text-amber-900',
        icon: <AlertTriangle className="h-4 w-4 text-amber-700" />,
        label: 'Circuit Open',
      };
    }

    return {
      shell: 'border-teal-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98),rgba(236,253,245,0.92))]',
      text: 'text-teal-950',
      subtext: 'text-teal-700',
      badge: 'bg-teal-200 text-teal-900',
      icon: <ShieldCheck className="h-4 w-4 text-teal-700" />,
      label: 'Protected',
    };
  }, [zoho?.circuit.isOpen]);

  return (
    <section className={`border-b px-4 py-3 ${tone.shell}`}>
      <div className="mb-2 flex items-start justify-between gap-4 border-b border-[var(--color-neutral-200)] pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center">
              {tone.icon}
            </div>
            <p className={`text-[var(--text-sm)] font-semibold uppercase tracking-[0.18em] ${tone.text}`}>
              Zoho Inbound Sync
            </p>
            <StatusBadge
              status={zoho?.circuit.isOpen ? 'overdue' : 'confirmed'}
              label={isLoading ? 'Checking' : tone.label}
            />
          </div>
          <p className={`mt-2 text-[var(--text-sm)] ${tone.subtext}`}>
            Budgeted for {zoho?.configured_headroom || '80/100 req per minute'}, capped at {zoho?.max_concurrent ?? 8} concurrent calls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || !!zoho?.circuit.isOpen}
          className="inline-flex items-center gap-2 border-b border-[var(--color-neutral-900)] py-1 text-[var(--text-xs)] font-semibold uppercase tracking-[0.18em] text-[var(--color-neutral-900)] transition hover:text-[var(--color-brand-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Queue an incremental Zoho purchase-order sync"
        >
          {syncMutation.isPending ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Sync Expected PO Lines
        </button>
      </div>

      <div>
        <MetricLineRow
          label="Limiter"
          value={zoho ? `${zoho.limiter.reservoir} left` : 'Loading...'}
          meta={zoho ? `${zoho.limiter.activeCount} active · ${zoho.limiter.queueSize} queued` : 'Checking limiter state'}
        />
        <MetricLineRow
          label="Retry Policy"
          value={
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-[var(--color-neutral-700)]" />
              {zoho?.max_retries ?? 4} attempts
            </span>
          }
          meta={zoho?.circuit.isOpen ? `Circuit resumes in ${fmtRetry(zoho.circuit.retryAfterMs)}` : 'Backoff is active for 429 and 5xx responses'}
        />
        <MetricLineRow
          label="Circuit"
          value={
            <span className="inline-flex items-center gap-2">
              <StatusBadge status={zoho?.circuit.isOpen ? 'overdue' : 'active'} label={zoho?.circuit.isOpen ? 'Open' : 'Closed'} />
              <span>{zoho?.circuit.consecutiveFailures ?? 0} recent failures</span>
            </span>
          }
          meta="Background jobs fail fast while the circuit is open."
          className="border-b-0 pb-0"
        />
      </div>
    </section>
  );
}
