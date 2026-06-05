/**
 * LLM-backed disposition suggestion for received/tested units (roadmap B3).
 *
 * Given the QA outcome, condition grade, and the tester's free-text notes,
 * suggest a disposition code (ACCEPT / HOLD / RTV / SCRAP / REWORK). The
 * free-text notes are where the AI earns its keep — "blown driver, fixable"
 * → REWORK vs "cracked housing, total loss" → SCRAP — beyond what a flat
 * qa_status × condition lookup can decide.
 *
 * Same discipline as the rest of the AI surface: local Hermes gateway only,
 * forced single tool call, temperature 0 (inside `hermesToolCall`). Suggestion
 * only — the operator confirms or overrides before it's written.
 */

import { hermesToolCall } from '@/lib/ai/hermes-tool-call';

const TOOL_NAME = 'report_disposition';

// Matches disposition_enum in the DB (2026-03-05_receiving_qa_and_zoho_fields).
const DISPOSITIONS = ['ACCEPT', 'HOLD', 'RTV', 'SCRAP', 'REWORK'] as const;
export type DispositionCode = (typeof DISPOSITIONS)[number];

const SYSTEM_PROMPT = [
  'You decide what to do with a received unit after inspection (its disposition).',
  '',
  'Pick one disposition:',
  '- ACCEPT = good to stock / sell as-is at its graded condition.',
  '- HOLD   = needs a human decision or more info; the safe default when unsure.',
  '- RTV    = return to vendor (wrong item, vendor defect, not economical to fix).',
  '- REWORK = repairable in-house, then it can be sold (e.g. a fixable fault).',
  '- SCRAP  = damaged beyond economical repair / total loss.',
  '',
  'Weigh the QA outcome, the condition grade, and especially the tester notes.',
  'Confidence: high = the notes clearly imply it; medium = reasonable inference;',
  'low = a guess from thin information (prefer HOLD when truly unsure).',
  '',
  `Call the \`${TOOL_NAME}\` tool exactly once and stop. Do not reply with prose.`,
].join('\n');

export interface DispositionInput {
  qaStatus?: string | null;
  conditionGrade?: string | null;
  notes?: string | null;
}

export interface DispositionSuggestion {
  dispositionCode: DispositionCode;
  confidence: 'high' | 'medium' | 'low';
  model: string;
}

interface DispositionToolArgs {
  disposition?: unknown;
  confidence?: unknown;
}

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export async function classifyDispositionWithLlm(
  input: DispositionInput,
): Promise<DispositionSuggestion> {
  const notes = String(input.notes ?? '').trim();
  const qa = String(input.qaStatus ?? '').trim();
  const grade = String(input.conditionGrade ?? '').trim();
  if (!notes && !qa && !grade) {
    throw new Error('Need at least a QA status, condition, or notes to suggest a disposition');
  }

  const userText = [
    `QA outcome: ${qa || '(not set)'}`,
    `Condition grade: ${grade || '(not set)'}`,
    '',
    'Tester notes:',
    notes || '(none provided)',
  ].join('\n');

  const { args, model } = await hermesToolCall<DispositionToolArgs>({
    systemPrompt: SYSTEM_PROMPT,
    userText,
    // Headroom for "thinking" models that emit reasoning before the tool call —
    // too small a budget gets spent on reasoning and the call never lands.
    maxTokens: 768,
    tool: {
      name: TOOL_NAME,
      description: 'Report the suggested disposition for this unit.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          disposition: { type: 'string', enum: [...DISPOSITIONS] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['disposition', 'confidence'],
      },
    },
  });

  return {
    // Default to HOLD — the safe "needs a human" bucket — on any junk output.
    dispositionCode: coerce(args.disposition, DISPOSITIONS, 'HOLD'),
    confidence: coerce(args.confidence, ['high', 'medium', 'low'] as const, 'low'),
    model,
  };
}
