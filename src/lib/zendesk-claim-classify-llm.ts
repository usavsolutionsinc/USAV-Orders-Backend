/**
 * LLM-backed classification for receiving claims (roadmap B2).
 *
 * Given the operator's free-text "what happened" note, suggest a claim type
 * and severity so the operator doesn't have to categorize by hand. A Type-B
 * classify: pick a label from a fixed set + confidence; the operator confirms
 * by leaving the suggestion or overriding it.
 *
 * Same discipline as the rest of the AI surface: local Hermes gateway only,
 * forced single tool call, temperature 0 (inside `hermesToolCall`). Suggestion
 * only — nothing is filed off the back of this.
 */

import { hermesToolCall } from '@/lib/ai/hermes-tool-call';

const TOOL_NAME = 'report_claim_classification';

// The modal exposes these four claim types (unfound / repair_service are
// routing states set elsewhere, not inferable from a damage note).
const CLAIM_TYPES = ['damage', 'missing', 'wrong_item', 'vendor_defect'] as const;
const SEVERITIES = ['low', 'medium', 'high'] as const;

export type ClassifiableClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimSeverityLevel = (typeof SEVERITIES)[number];

const SYSTEM_PROMPT = [
  'You triage a warehouse receiving problem from the operator\'s short note.',
  '',
  'Pick the single best claim type:',
  '- damage        = the item or its packaging arrived physically damaged.',
  '- missing       = some or all expected units are not in the package.',
  '- wrong_item    = the item received is not what was ordered.',
  '- vendor_defect = the item is the right one but faulty / DOA / fails QA.',
  '',
  'Pick a severity:',
  '- low    = minor, cosmetic, or easily resolved.',
  '- medium = a real problem but not blocking; the default when unsure.',
  '- high   = total loss, many units affected, or high-value / urgent.',
  '',
  'Confidence: high = the note clearly states it; medium = reasonable inference;',
  'low = a guess from thin information.',
  '',
  `Call the \`${TOOL_NAME}\` tool exactly once and stop. Do not reply with prose.`,
].join('\n');

export interface ClaimClassification {
  claimType: ClassifiableClaimType;
  severity: ClaimSeverityLevel;
  confidence: 'high' | 'medium' | 'low';
  model: string;
}

interface ClassifyToolArgs {
  claim_type?: unknown;
  severity?: unknown;
  confidence?: unknown;
}

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export async function classifyClaimWithLlm(reason: string): Promise<ClaimClassification> {
  const note = String(reason ?? '').trim();
  if (!note) throw new Error('No note to classify');

  const { args, model } = await hermesToolCall<ClassifyToolArgs>({
    systemPrompt: SYSTEM_PROMPT,
    userText: `Operator's note (what happened):\n${note}`,
    maxTokens: 256,
    tool: {
      name: TOOL_NAME,
      description: 'Report the suggested claim type and severity for this note.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          claim_type: { type: 'string', enum: [...CLAIM_TYPES] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['claim_type', 'severity', 'confidence'],
      },
    },
  });

  return {
    claimType: coerce(args.claim_type, CLAIM_TYPES, 'damage'),
    severity: coerce(args.severity, SEVERITIES, 'medium'),
    confidence: coerce(args.confidence, ['high', 'medium', 'low'] as const, 'low'),
    model,
  };
}
