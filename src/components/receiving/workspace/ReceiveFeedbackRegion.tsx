'use client';

/* ──────────────────────────────────────────────────────────────────────────
 * ReceiveFeedbackRegion
 *
 * The single inline home for receive feedback, mounted below the label preview
 * in LineEditPanel. Replaces the old bottom-right toast entirely — feedback now
 * lives where the operator's eyes already are (the label / receive area), which
 * is the bulk of the perceived-speed win. One crossfading region, three states:
 *
 *   receiving                → ReceiveInlineProgress  (compact indeterminate bar)
 *   receiveResult: success   → ReceiveSuccessChecklist (staggered green checks)
 *   receiveResult: diagnostic→ ReceiveResponsePanel    (skip / cooldown / error)
 *
 * The success checklist is OPTIMISTIC: the three Zoho writes (purchase receive,
 * per-line description PUT, PO notes PUT) run server-side in after(), so the
 * checks render immediately from the response summary. A background failure is
 * reconciled via the realtime `zohoReceive` verdict on the station channel —
 * the card flips to a retryable amber state rather than leaving false checks.
 * ────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown, Loader2, X } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import {
  framerPresence,
  framerTransition,
} from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import { getStationChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { ReceiveResponsePanel } from './ReceiveResponsePanel';
import type {
  ReceiveInFlight,
  ReceiveResult,
  ReceiveSummary,
} from './line-edit/hooks/useReceiveAction';

/* ── Compact in-flight strip (was the sticky bottom-right toast) ──────────── */

function ReceiveInlineProgress({ startedAt, intent }: ReceiveInFlight) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const label = intent === 'scan_only' ? 'Marking as scanned…' : 'Receiving…';
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-caption font-bold text-blue-900">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {label}
        </span>
        <span className="text-eyebrow font-semibold tabular-nums text-blue-500">{elapsed}s</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-200/70">
        <div className="recv-indet-bar h-full w-1/3 rounded-full bg-blue-500" />
      </div>
    </div>
  );
}

/* ── The success checklist ───────────────────────────────────────────────── */

type ChecklistView = {
  tone: 'emerald' | 'amber';
  headline: string;
  /** Lines that earn a staggered green check. */
  items: string[];
  /** A muted sub-line that does NOT get a check (informational). */
  note?: string;
};

function buildView(summary: ReceiveSummary, failed: boolean): ChecklistView {
  if (failed) {
    return {
      tone: 'amber',
      headline: 'Zoho receive didn’t go through',
      items: [],
      note: 'Saved locally — lines stay Scanned and will retry. Re-run Receive if it doesn’t clear.',
    };
  }
  if (summary.alreadyReceived) {
    return {
      tone: 'emerald',
      headline: 'Already received in Zoho',
      items: ['Local state now matches the dashboard'],
    };
  }
  if (summary.intent === 'scan_only' || summary.localOnly) {
    if (summary.isUnfound) {
      return {
        tone: 'emerald',
        headline: 'Received locally',
        items: ['Marked as received locally'],
        note: 'Unfound carton — label printed, Zoho not touched.',
      };
    }
    return {
      tone: 'emerald',
      headline: 'Marked as scanned locally',
      items: ['Saved quantities as Scanned'],
      note: 'Zoho not updated — run Receive to sync inventory.',
    };
  }
  // Normal Zoho receive — the headline checklist.
  const n = summary.descriptionsUpdated;
  const plural = n === 1 ? '' : 's';
  const items: string[] = ['Marked as received'];
  if (n > 0) {
    items.push(`Updated ${n} product description${plural} with condition & serial number${plural}`);
  }
  if (summary.notesUpdated) {
    items.push('Updated notes field to Zoho');
  }
  return { tone: 'emerald', headline: 'Receive complete', items };
}

// Gentle pop on each check as its row staggers in. Module-level + typed so the
// `type: 'spring'` literal doesn't widen to `string` under inference. Damping is
// tuned high (minimal overshoot) — this is a serious ops surface, not a toy.
const CHECK_ICON_VARIANTS: Variants = {
  initial: { scale: 0.5, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 500, damping: 26 },
  },
};

const TONE = {
  emerald: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    bar: 'bg-emerald-500',
    title: 'text-emerald-900',
    icon: 'text-emerald-500',
    body: 'text-emerald-900',
  },
  amber: {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    bar: 'bg-amber-500',
    title: 'text-amber-900',
    icon: 'text-amber-500',
    body: 'text-amber-900',
  },
} as const;

function ReceiveSuccessChecklist({
  result,
  onDismiss,
}: {
  result: Extract<ReceiveResult, { kind: 'success' }>;
  onDismiss: () => void;
}) {
  const reduce = useReducedMotion();
  const item = useMotionPresence({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } });
  // House collapse preset for the details dropdown (height:auto is the one
  // sanctioned layout animation — low-frequency expand only). Reduced motion
  // collapses it to a pure opacity fade via the hook.
  const collapse = useMotionPresence(framerPresence.collapseHeight);
  const collapseTransition = useMotionTransition(framerTransition.stationCollapse);

  // Reconcile the optimistic checks against the real background verdict. The
  // mark-received-po after() publishes `zohoReceive: 'ok' | 'failed'` per line
  // on the org station channel once the Zoho purchase receive settles. A
  // demoStatus (dev test button) skips the realtime path and shows it outright.
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const channel = safeChannelName(() => getStationChannelName(orgId!));
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>(
    result.demoStatus ?? 'pending',
  );
  const [detailsOpen, setDetailsOpen] = useState(false);

  useAblyChannel(
    channel,
    'receiving-log.changed',
    (msg: { data?: { rowId?: unknown; zohoReceive?: unknown } }) => {
      const data = msg?.data;
      const verdict = data?.zohoReceive;
      if (verdict !== 'ok' && verdict !== 'failed') return;
      const rowId = Number(data?.rowId);
      if (!Number.isFinite(rowId) || !result.lineIds.includes(rowId)) return;
      setStatus(verdict === 'ok' ? 'confirmed' : 'failed');
    },
    result.reconcile && !result.demoStatus && Boolean(orgId) && Boolean(channel),
  );

  const view = buildView(result.summary, status === 'failed');
  const tone = TONE[view.tone];
  const timestamp = new Date(result.at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Key/value rows for the details dropdown.
  const detailRows: Array<[string, string]> = [
    ['Intent', result.summary.intent === 'scan_only' ? 'Scan only (local)' : 'Zoho receive'],
    ['Receiving', `#${result.receivingId}`],
    ['Lines', result.lineIds.length ? result.lineIds.map((id) => `#${id}`).join(', ') : '—'],
    ['Descriptions', String(result.summary.descriptionsUpdated)],
    ['Notes pushed', result.summary.notesUpdated ? 'Yes' : 'No'],
    ['Marked received', result.summary.markedReceived ? 'Yes' : 'No'],
    ['Sync', result.reconcile ? status : 'n/a'],
    ['Response', `HTTP ${result.response.httpStatus || '—'} · ${result.response.durationMs}ms`],
  ];

  return (
    <div className={`relative overflow-hidden rounded-lg border ${tone.border} ${tone.bg}`}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.bar}`} aria-hidden />
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-eyebrow font-black uppercase tracking-widest ${tone.title}`}>
              {view.headline}
            </p>
            <span className="shrink-0 text-eyebrow font-semibold tabular-nums text-slate-400">
              {timestamp}
            </span>
          </div>

          <motion.ul
            className="mt-1.5 space-y-1"
            initial="initial"
            animate="animate"
            variants={{
              animate: {
                transition: {
                  staggerChildren: reduce ? 0 : 0.08,
                  delayChildren: reduce ? 0 : 0.04,
                },
              },
            }}
          >
            {view.items.map((label, i) => (
              <motion.li
                key={`${i}-${label}`}
                variants={item as Variants}
                className={`flex items-start gap-1.5 text-caption font-semibold leading-snug ${tone.body}`}
              >
                <motion.span
                  variants={reduce ? undefined : CHECK_ICON_VARIANTS}
                  className="mt-px shrink-0"
                >
                  <Check className={`h-4 w-4 ${tone.icon}`} />
                </motion.span>
                <span className="min-w-0">{label}</span>
              </motion.li>
            ))}
          </motion.ul>

          {view.note ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-micro font-medium leading-snug text-slate-600">
              {view.tone === 'amber' ? (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : null}
              <span className="min-w-0">{view.note}</span>
            </p>
          ) : null}

          {/* Reconcile footer — only while a real Zoho receive is in flight. */}
          {result.reconcile && status === 'pending' && view.tone === 'emerald' ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing to Zoho…
            </p>
          ) : null}
          {status === 'confirmed' ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-emerald-600">
              <Check className="h-3 w-3" />
              Confirmed in Zoho
            </p>
          ) : null}

          {/* Details dropdown — disclosure of the per-action breakdown. */}
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="mt-1.5 -ml-0.5 flex items-center gap-1 rounded text-eyebrow font-black uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-600"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform duration-150 ${detailsOpen ? 'rotate-180' : ''}`}
            />
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>

          <AnimatePresence initial={false}>
            {detailsOpen ? (
              <motion.div
                key="details"
                initial={collapse.initial}
                animate={collapse.animate}
                exit={collapse.exit}
                transition={collapseTransition}
                className="overflow-hidden"
              >
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded border border-slate-200 bg-white/70 px-2 py-1.5">
                  {detailRows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-micro font-semibold uppercase tracking-wide text-slate-400">
                        {k}
                      </dt>
                      <dd className="min-w-0 break-words text-micro font-medium text-slate-700">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-white/60 hover:text-slate-700"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ── Region switcher (crossfades the three states) ───────────────────────── */

export function ReceiveFeedbackRegion({
  receiving,
  receiveResult,
  responseExpanded,
  setResponseExpanded,
  onDismiss,
}: {
  receiving: ReceiveInFlight | null;
  receiveResult: ReceiveResult | null;
  responseExpanded: boolean;
  setResponseExpanded: (next: boolean) => void;
  onDismiss: () => void;
}) {
  const presence = useMotionPresence(framerPresence.workbenchPane);
  const transition = useMotionTransition(framerTransition.workbenchPaneMount);

  const phase: 'progress' | 'success' | 'diagnostic' | 'none' = receiving
    ? 'progress'
    : receiveResult?.kind === 'success'
      ? 'success'
      : receiveResult?.kind === 'diagnostic'
        ? 'diagnostic'
        : 'none';

  // Key the success child by its timestamp so a fresh receive replays the
  // stagger; progress/diagnostic are stable.
  const childKey =
    phase === 'success' && receiveResult?.kind === 'success'
      ? `success-${receiveResult.at}`
      : phase;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'none' ? null : (
        <motion.div
          key={childKey}
          initial={presence.initial}
          animate={presence.animate}
          exit={presence.exit}
          transition={transition}
        >
          {phase === 'progress' && receiving ? (
            <ReceiveInlineProgress startedAt={receiving.startedAt} intent={receiving.intent} />
          ) : phase === 'success' && receiveResult?.kind === 'success' ? (
            <ReceiveSuccessChecklist result={receiveResult} onDismiss={onDismiss} />
          ) : phase === 'diagnostic' && receiveResult?.kind === 'diagnostic' ? (
            <WorkspaceCard label="Last receive" bodyClassName="px-0 py-0">
              <ReceiveResponsePanel
                response={receiveResult.response}
                expanded={responseExpanded}
                onToggle={() => setResponseExpanded(!responseExpanded)}
                onDismiss={onDismiss}
              />
            </WorkspaceCard>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Dev/preview test button ─────────────────────────────────────────────── */

function makeSummary(over: Partial<ReceiveSummary>): ReceiveSummary {
  return {
    markedReceived: true,
    descriptionsUpdated: 1,
    notesUpdated: false,
    localOnly: false,
    intent: 'zoho_receive',
    isUnfound: false,
    alreadyReceived: false,
    ...over,
  };
}

function demoResult(
  summary: ReceiveSummary,
  opts: { reconcile?: boolean; demoStatus?: 'pending' | 'confirmed' | 'failed' } = {},
): ReceiveResult {
  const at = Date.now();
  return {
    kind: 'success',
    at,
    summary,
    receivingId: 9999,
    lineIds: [4567, 4568],
    reconcile: opts.reconcile ?? true,
    demoStatus: opts.demoStatus,
    response: {
      at,
      durationMs: 1240,
      httpStatus: 200,
      ok: true,
      body: { success: true, demo: true, summary, zoho: { attempted: 1, ok: true, pending: true } },
    },
  };
}

const DEMO_SCENARIOS: Array<{ label: string; build: () => ReceiveResult }> = [
  {
    label: 'Receive · SN · notes (syncing)',
    build: () => demoResult(makeSummary({ descriptionsUpdated: 2, notesUpdated: true }), { demoStatus: 'pending' }),
  },
  {
    label: 'Receive · SN · notes (confirmed)',
    build: () => demoResult(makeSummary({ descriptionsUpdated: 2, notesUpdated: true }), { demoStatus: 'confirmed' }),
  },
  {
    label: 'Receive · 1 SN',
    build: () => demoResult(makeSummary({ descriptionsUpdated: 1 }), { demoStatus: 'confirmed' }),
  },
  {
    label: 'Scan only (local)',
    build: () =>
      demoResult(
        makeSummary({ intent: 'scan_only', localOnly: true, markedReceived: false, descriptionsUpdated: 0 }),
        { reconcile: false },
      ),
  },
  {
    label: 'Unfound · local',
    build: () =>
      demoResult(
        makeSummary({
          intent: 'scan_only',
          localOnly: true,
          isUnfound: true,
          markedReceived: false,
          descriptionsUpdated: 0,
        }),
        { reconcile: false },
      ),
  },
  {
    label: 'Already received',
    build: () => demoResult(makeSummary({ alreadyReceived: true, descriptionsUpdated: 0 }), { reconcile: false }),
  },
  {
    label: 'Zoho failed',
    build: () => demoResult(makeSummary({ descriptionsUpdated: 2, notesUpdated: true }), { demoStatus: 'failed' }),
  },
];

/**
 * Dev/preview-only trigger that injects a synthetic receive result so the whole
 * ReceiveFeedbackRegion (stagger, details dropdown, reconcile states) can be
 * previewed without a real Zoho roundtrip. Each press advances to the next
 * scenario and re-keys the region (fresh `at`) so the stagger replays. Gated by
 * the caller — never rendered for normal operators.
 */
export function ReceiveUiTestButton({ onEmit }: { onEmit: (result: ReceiveResult) => void }) {
  // Self-gate: visible in dev, or on any env via ?receiveUiTest (so it can be
  // exercised on a preview deploy too). NODE_ENV is the SSR-stable seed; the
  // query-param escape is applied client-side post-mount to avoid a hydration
  // mismatch. Never shown to normal operators in production.
  const [enabled, setEnabled] = useState(process.env.NODE_ENV !== 'production');
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('receiveUiTest')) {
      setEnabled(true);
    }
  }, []);

  const idxRef = useRef(0);
  const [lastLabel, setLastLabel] = useState<string | null>(null);

  if (!enabled) return null;

  const fire = () => {
    const scenario = DEMO_SCENARIOS[idxRef.current];
    onEmit(scenario.build());
    setLastLabel(scenario.label);
    idxRef.current = (idxRef.current + 1) % DEMO_SCENARIOS.length;
  };

  return (
    <button
      type="button"
      onClick={fire}
      title="Preview the receive feedback UI — each press cycles a scenario (dev/preview only)"
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-violet-300 bg-violet-50 px-2 py-1.5 text-eyebrow font-black uppercase tracking-widest text-violet-700 transition-colors hover:bg-violet-100"
    >
      <Check className="h-3 w-3 shrink-0" />
      {lastLabel ? `Test UI · ${lastLabel}` : 'Test receive UI'}
    </button>
  );
}
