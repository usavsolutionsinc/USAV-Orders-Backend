/**
 * Soft workflow recommendations for receiving — industry-standard nudges, never
 * hard gates. Small-business tenants can bypass any step; recommendations surface
 * as goals for staff who want to level up their process over time.
 *
 * Pure + DB-free. UI reads these and renders chips/toasts; nothing here blocks
 * an action.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { isTriageClassified, isTriagePaired } from './triage-focus';

export type RecommendationTone = 'info' | 'success' | 'tip';

export interface WorkflowRecommendation {
  id: string;
  tone: RecommendationTone;
  title: string;
  detail?: string;
}

export interface ReceivingWorkflowFacts {
  row: ReceivingLineRow;
  /** Active surface the operator is on. */
  surface: 'triage' | 'unbox';
  photoCount?: number;
  itemPhotoCount?: number;
  packagePhotoCount?: number;
  conditionExplicitlySet?: boolean;
}

/** Triage-surface recommendations (door → stage → hand off). */
export function triageRecommendations(facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  const { row } = facts;
  const out: WorkflowRecommendation[] = [];

  if (!isTriageClassified(row) && row.receiving_source === 'unmatched') {
    out.push({
      id: 'triage-classify',
      tone: 'tip',
      title: 'Classify the package type',
      detail: 'Industry best practice: tag PO vs return at the door so the unbox bench knows what to expect.',
    });
  }

  if (!isTriagePaired(row) && row.receiving_source === 'unmatched') {
    out.push({
      id: 'triage-pair',
      tone: 'info',
      title: 'Pair to a PO or claim when you can',
      detail: 'Optional for small shops — saves time at unbox. You can still save for unbox without a match.',
    });
  }

  return out;
}

/** Unbox surface — no soft nudges; the progress stepper carries workflow state. */
export function unboxRecommendations(_facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  return [];
}

export function surfaceRecommendations(facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  return facts.surface === 'triage' ? triageRecommendations(facts) : unboxRecommendations(facts);
}
