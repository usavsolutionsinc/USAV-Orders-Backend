import { workflowStage } from '@/lib/receiving/workflow-stages';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';

export type CartonPipelineKey = 'scanned' | 'unboxed' | 'received';
export type CartonPipelineState = 'done' | 'active' | 'pending';

export type CartonReadinessStage =
  | 'awaiting_scan'
  | 'awaiting_unbox'
  | 'awaiting_receive'
  | 'lines_in_progress'
  | 'carton_received';

export type CartonReadinessCta = 'continue_unbox' | 'match_po' | 'none';

export type CartonReadinessPillTone = 'neutral' | 'blue' | 'amber' | 'emerald';

export type CartonReadiness = {
  stage: CartonReadinessStage;
  headline: string;
  nextStep: string;
  cta: CartonReadinessCta;
  pillTone: CartonReadinessPillTone;
  pipelineStates: Record<CartonPipelineKey, CartonPipelineState>;
  lineCount?: number;
  linesComplete?: number;
};

export type ReceivingMatchLine = {
  quantity_expected?: number | null;
  quantity_received?: number | null;
  workflow_status?: string | null;
};

function hasStamp(value: string | null | undefined): boolean {
  return Boolean(value && String(value).trim());
}

export function summarizeReceivingMatchLines(
  lines: ReadonlyArray<ReceivingMatchLine> | null | undefined,
): { lineCount: number; linesComplete: number; slowestWorkflowStatus: string | null } {
  const arr = Array.isArray(lines) ? lines : [];
  let linesComplete = 0;
  let slowest: { status: string | null; order: number } | null = null;

  for (const line of arr) {
    const expected = typeof line.quantity_expected === 'number' ? line.quantity_expected : null;
    const received = typeof line.quantity_received === 'number' ? line.quantity_received : 0;
    if (expected != null && expected > 0 && received >= expected) linesComplete += 1;

    const status = line.workflow_status ?? null;
    const meta = workflowStage(status);
    if (!slowest || meta.order < slowest.order) slowest = { status, order: meta.order };
  }

  return {
    lineCount: arr.length,
    linesComplete,
    slowestWorkflowStatus: slowest?.status ?? null,
  };
}

export function deriveCartonReadiness(
  log: Pick<
    ReceivingDetailsLog,
    'tracking_scanned_at' | 'unboxed_at' | 'received_at'
  >,
  matchLines?: ReadonlyArray<ReceivingMatchLine> | null,
): CartonReadiness {
  const scanned = hasStamp(log.tracking_scanned_at);
  const unboxed = hasStamp(log.unboxed_at);
  const received = hasStamp(log.received_at);

  const { lineCount, linesComplete } = summarizeReceivingMatchLines(matchLines);
  const hasLines = lineCount > 0;
  const allLinesComplete = hasLines && linesComplete >= lineCount;

  const pipelineStates: CartonReadiness['pipelineStates'] = {
    scanned: scanned ? 'done' : 'active',
    unboxed: 'pending',
    received: 'pending',
  };
  if (scanned) {
    pipelineStates.unboxed = unboxed ? 'done' : 'active';
    pipelineStates.received = unboxed ? (received ? 'done' : 'active') : 'pending';
  }

  if (!scanned) {
    return {
      stage: 'awaiting_scan',
      headline: 'Awaiting scan',
      nextStep: 'Scan tracking at receiving.',
      cta: 'none',
      pillTone: 'neutral',
      pipelineStates,
      lineCount,
      linesComplete,
    };
  }

  if (!unboxed) {
    return {
      stage: 'awaiting_unbox',
      headline: 'Awaiting unbox',
      nextStep: 'Ready to unbox — open the workspace and start the line flow.',
      cta: hasLines ? 'continue_unbox' : 'match_po',
      pillTone: 'blue',
      pipelineStates,
      lineCount,
      linesComplete,
    };
  }

  if (!received) {
    return {
      stage: 'awaiting_receive',
      headline: 'In unbox',
      nextStep: 'Finish line work, then mark received.',
      cta: 'continue_unbox',
      pillTone: 'amber',
      pipelineStates,
      lineCount,
      linesComplete,
    };
  }

  if (hasLines && !allLinesComplete) {
    return {
      stage: 'lines_in_progress',
      headline: 'Received · lines open',
      nextStep: `Carton received — ${linesComplete}/${lineCount} lines complete.`,
      cta: 'none',
      pillTone: 'blue',
      pipelineStates,
      lineCount,
      linesComplete,
    };
  }

  return {
    stage: 'carton_received',
    headline: 'Complete',
    nextStep: 'No action needed.',
    cta: 'none',
    pillTone: 'emerald',
    pipelineStates,
    lineCount,
    linesComplete,
  };
}

