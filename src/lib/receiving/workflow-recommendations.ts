/**
 * Soft workflow recommendations for receiving — industry-standard nudges, never
 * hard gates. Small-business tenants can bypass any step; recommendations surface
 * as goals for staff who want to level up their process over time.
 *
 * Pure + DB-free. UI reads these and renders chips/toasts; nothing here blocks
 * an action.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

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
export function triageRecommendations(_facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  return [];
}

/** Unbox surface — no soft nudges; the progress stepper carries workflow state. */
export function unboxRecommendations(_facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  return [];
}

export function surfaceRecommendations(facts: ReceivingWorkflowFacts): WorkflowRecommendation[] {
  return facts.surface === 'triage' ? triageRecommendations(facts) : unboxRecommendations(facts);
}
