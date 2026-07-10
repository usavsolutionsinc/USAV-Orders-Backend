'use client';

/**
 * AgentStepTimeline — agent-transparency stepper for the AI chat
 * (docs/todo/ai-chat-ux-plan.md §6.4, Tier A).
 *
 * While an answer streams it renders the SSE `step` labels as a small live
 * timeline with an elapsed timer; when no real steps have arrived yet it
 * synthesizes a heuristic label from elapsed time so the wait never reads as
 * a dead spinner. Once the run finishes it collapses to a one-line disclosure
 * ("Worked Ns · M steps") that can be re-expanded.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { useMotionPresence, useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import { Button } from '@/design-system/primitives';
import type { AgentStep } from '@/components/ai/useAiChat';
import { cn } from '@/utils/_cn';

/** Tier A heuristic — a synthetic label when the backend has sent no `step` frame yet. */
function heuristicLabel(elapsedSec: number): string {
  if (elapsedSec < 4) return 'Understanding the question';
  if (elapsedSec < 15) return 'Querying live data';
  return 'Composing the answer';
}

function formatSeconds(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

export interface AgentStepTimelineProps {
  steps: AgentStep[];
  /** true while the answer is still streaming */
  streaming: boolean;
  /** run start — drives the elapsed timer */
  startedAt: number;
  /** run end — freezes the collapsed summary duration */
  doneAt?: number;
  className?: string;
}

export default function AgentStepTimeline({ steps, streaming, startedAt, doneAt, className }: AgentStepTimelineProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  const rowPresence = useMotionPresence(framerPresence.stationSerialRow);
  const rowTransition = useMotionTransition(framerTransition.stationSerialRow);
  const collapsePresence = useMotionPresence(framerPresence.collapseHeight);
  const collapseTransition = useMotionTransition(framerTransition.stationCollapse);

  // Tick the elapsed timer only while streaming.
  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [streaming]);

  const endMs = streaming ? now : (doneAt ?? now);
  const elapsedSec = Math.max(0, Math.floor((endMs - startedAt) / 1000));

  const visibleSteps: AgentStep[] = steps.length > 0
    ? steps
    : streaming
      ? [{ label: heuristicLabel(elapsedSec), at: startedAt }]
      : [];

  if (!streaming && visibleSteps.length === 0) return null;

  // Collapsed summary once the run is done.
  if (!streaming) {
    return (
      <div className={className}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          ariaLabel={expanded ? 'Hide agent steps' : 'Show agent steps'}
          className="-ml-1.5 gap-1.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
          icon={<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded ? 'rotate-180' : '')} />}
        >
          {`Worked ${formatSeconds(elapsedSec)} · ${visibleSteps.length} ${visibleSteps.length === 1 ? 'step' : 'steps'}`}
        </Button>
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="steps"
              initial={collapsePresence.initial}
              animate={collapsePresence.animate}
              exit={collapsePresence.exit}
              transition={collapseTransition}
              className="overflow-hidden"
            >
              <ul className="mt-1 space-y-1 border-l border-border-soft pl-3">
                {visibleSteps.map((s, i) => (
                  <li key={`${s.at}-${i}`} className="flex items-center gap-1.5 text-caption text-text-muted">
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{s.label}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  // Live view while streaming.
  const lastIdx = visibleSteps.length - 1;
  return (
    <div className={className}>
      <div className={cn('flex items-center gap-2', sectionLabel)}>
        <span>Working</span>
        {elapsedSec > 0 ? <span className="font-semibold normal-case tracking-normal text-text-faint">{formatSeconds(elapsedSec)}</span> : null}
      </div>
      <ul className="mt-1.5 space-y-1 border-l border-border-soft pl-3">
        <AnimatePresence initial={false}>
          {visibleSteps.map((s, i) => (
            <motion.li
              key={`${s.label}-${i}`}
              initial={rowPresence.initial}
              animate={rowPresence.animate}
              transition={rowTransition}
              className="flex items-center gap-1.5 text-caption text-text-muted"
            >
              {i === lastIdx ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              )}
              <span className="truncate">{s.label}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
