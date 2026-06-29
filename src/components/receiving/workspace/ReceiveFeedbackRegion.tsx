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

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from '@/components/Icons';
import { WorkspaceCard } from '@/design-system/components';
import { Button } from '@/design-system/primitives';
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
import { InlineActionFeedbackCard } from './InlineActionFeedbackCard';
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

function ReceiveSuccessChecklist({
  result,
  onDismiss,
}: {
  result: Extract<ReceiveResult, { kind: 'success' }>;
  onDismiss: () => void;
}) {
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
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');
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
    result.reconcile && Boolean(orgId) && Boolean(channel),
  );

  const view = buildView(result.summary, status === 'failed');

  // Key/value rows for the details dropdown — show real note/description text
  // when present; omit internal ids (receiving / line ids).
  const detailRows: Array<[string, string]> = [
    ['Intent', result.summary.intent === 'scan_only' ? 'Scan only (local)' : result.summary.intent === 'local_receive' ? 'Received locally' : 'Zoho receive'],
    ...(result.summary.itemDescription
      ? [['Item description', result.summary.itemDescription] as [string, string]]
      : []),
    ...(result.summary.poNotes
      ? [['PO notes', result.summary.poNotes] as [string, string]]
      : []),
    ['Marked received', result.summary.markedReceived ? 'Yes' : 'No'],
    ['Sync', result.reconcile ? status : 'n/a'],
    ['Response', `HTTP ${result.response.httpStatus || '—'} · ${result.response.durationMs}ms`],
  ];

  return (
    <InlineActionFeedbackCard
      tone={view.tone}
      headline={view.headline}
      items={view.items}
      note={view.note}
      at={result.at}
      onDismiss={onDismiss}
      footer={
        <>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            icon={
              <ChevronDown
                className={`transition-transform duration-150 ${detailsOpen ? 'rotate-180' : ''}`}
              />
            }
            className="mt-1.5 -ml-0.5 text-eyebrow font-black uppercase tracking-widest text-slate-400 hover:text-slate-600"
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </Button>

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
                      <dd
                        className={`min-w-0 break-words text-micro font-medium text-slate-700 ${
                          k === 'Item description' || k === 'PO notes' ? 'whitespace-pre-wrap' : ''
                        }`}
                      >
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      }
    />
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

/* The dev/preview ReceiveUiTestButton was removed by request. To preview the
 * checklist states again, drive a real receive or temporarily inject a
 * `ReceiveResult` into `setReceiveResult`. */
