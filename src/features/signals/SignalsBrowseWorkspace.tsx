'use client';

/**
 * Signals ▸ Browse — the Workbench half of the two domain-linked history pages
 * (universal-feed plan Phase 5). A master-detail over `entity_signals`: a
 * searchable list (master) + the selected signal's full detail (crossfading
 * right pane, keyed on `?signalId=`). Durable, URL-addressable selection — the
 * Workbench contract, distinct from the Monitor timeline at `?mode=timeline`.
 *
 * Workbench half of Operations ▸ Signals: searchable list (master) + selected
 * signal detail (crossfading right pane, keyed on `?signalId=`). Search lives
 * in the global header; filters/selection are URL-driven.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { operationsHistoryTraceHref } from '@/lib/operations/history-links';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { SIGNAL_KINDS, SURFACE_ENTITY_TYPES } from '@/lib/surfaces/registry';
import type { EntitySignalTimelineRow } from '@/lib/timeline';
import type { EntitySignalDetail } from '@/lib/surfaces/entity-signals-read';
import { cn } from '@/utils/_cn';
import { replaceOperationsSignalsUrl } from './signals-url';

function kindLabel(kind: string): string {
  return (SIGNAL_KINDS as Record<string, { label: string } | undefined>)[kind]?.label ?? kind;
}
function entityLabel(type: string): string {
  return (SURFACE_ENTITY_TYPES as Record<string, { label: string } | undefined>)[type]?.label ?? type;
}
function shortTime(at: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SignalsBrowseWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signalId = Number(searchParams.get('signalId')) || null;
  const q = searchParams.get('q') ?? '';

  const paneMotion = useMotionPresence(framerPresence.workbenchPane);
  const paneTransition = useMotionTransition(framerTransition.workbenchPaneMount);

  const select = (id: number | null) => {
    replaceOperationsSignalsUrl(router, searchParams, (sp) => {
      sp.set('signalsView', 'browse');
      if (id) sp.set('signalId', String(id));
      else sp.delete('signalId');
    });
  };

  const { data: rows, isLoading: listLoading } = useQuery<EntitySignalTimelineRow[]>({
    queryKey: ['entity-signals', 'browse', q],
    staleTime: 30_000,
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/entity-signals?${sp.toString()}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const body = (await res.json().catch(() => null)) as { signals?: EntitySignalTimelineRow[] } | null;
      return body?.signals ?? [];
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<EntitySignalDetail | null>({
    queryKey: ['entity-signal', signalId],
    enabled: signalId != null,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/entity-signals/${signalId}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { signal?: EntitySignalDetail } | null;
      return body?.signal ?? null;
    },
  });

  const list = useMemo(() => rows ?? [], [rows]);

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Master list */}
      <div className={cn('flex w-full flex-col border-r border-border-hairline md:w-80 md:shrink-0', signalId != null && 'hidden md:flex')}>
        <div className="min-h-0 flex-1 divide-y divide-border-hairline overflow-y-auto">
          {listLoading ? (
            <p className="p-3 text-caption text-text-faint">Loading…</p>
          ) : list.length === 0 ? (
            <p className="p-3 text-caption text-text-faint">{q ? 'No signals match.' : 'No signals yet.'}</p>
          ) : (
            list.map((s) => (
              // ds-raw-button: master-list navigation row (sets ?signalId=), not a DS content button
              <button
                key={s.id}
                type="button"
                onClick={() => select(s.id)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors',
                  signalId === s.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-surface-hover',
                )}
              >
                <span className="truncate text-caption font-bold text-text-default">{kindLabel(s.signal_kind)}</span>
                <span className="truncate text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                  {entityLabel(s.entity_type)} #{s.entity_id}
                  {shortTime(s.occurred_at) ? ` · ${shortTime(s.occurred_at)}` : ''}
                </span>
                {s.reason_code ? (
                  <span className="rounded bg-surface-canvas px-1.5 text-mini font-black uppercase tracking-widest text-text-muted ring-1 ring-inset ring-border-soft">
                    {s.reason_code}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail (crossfades on selection) */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto', signalId == null && 'hidden md:block')}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`signal-${signalId ?? 'none'}`}
            initial={paneMotion.initial}
            animate={paneMotion.animate}
            exit={paneMotion.exit}
            transition={paneTransition}
            className="h-full"
          >
            {signalId == null ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="text-caption text-text-faint">Select a signal to see its detail.</p>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                {/* ds-raw-button: mobile back-link — shown for EVERY signalId state
                    (loading / not-found / detail) so a bad ?signalId= is never a dead end.
                    router.replace is used, so browser Back won't restore the list. */}
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="text-eyebrow font-black uppercase tracking-widest text-blue-600 md:hidden"
                >
                  ← Back
                </button>
                {detailLoading ? (
                  <p className="text-caption text-text-faint">Loading…</p>
                ) : !detail ? (
                  <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption text-text-faint">
                    Signal not found.
                  </div>
                ) : (
                  <>
                <div className="space-y-1">
                  <p className="text-lg font-black tracking-tight text-text-default">{kindLabel(detail.signal_kind)}</p>
                  <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                    {entityLabel(detail.entity_type)} #{detail.entity_id}
                  </p>
                </div>
                <Field label="Occurred">{fmt(detail.occurred_at)}</Field>
                {detail.reason_code ? <Field label="Reason code">{detail.reason_code}</Field> : null}
                {detail.severity != null ? <Field label="Severity">{String(detail.severity)}</Field> : null}
                {detail.notes ? <Field label="Notes">{detail.notes}</Field> : null}
                {detail.node_id ? <Field label="Node">{detail.node_id}</Field> : null}
                {detail.source_ref ? <Field label="Source ref">{detail.source_ref}</Field> : null}
                {detail.meta && Object.keys(detail.meta).length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">Meta</p>
                    <pre className="overflow-x-auto rounded-md bg-surface-canvas p-2 text-mini text-text-muted ring-1 ring-inset ring-border-soft">
                      {JSON.stringify(detail.meta, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {detail.entity_dim && detail.entity_ref ? (
                  <div className="border-t border-border-hairline pt-3">
                    <Link
                      href={operationsHistoryTraceHref({
                        dim: detail.entity_dim,
                        value: detail.entity_ref,
                      })}
                      className="inline-flex items-center gap-1 text-eyebrow font-black uppercase tracking-widest text-blue-600 transition hover:text-blue-700"
                    >
                      Full event trace →
                    </Link>
                  </div>
                ) : null}
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">{label}</p>
      <p className="text-caption text-text-default">{children}</p>
    </div>
  );
}

function fmt(at: string | null): string {
  if (!at) return '—';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
