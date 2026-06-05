/**
 * LLM-backed *drafting* for receiving-claim Zendesk tickets (roadmap item A1).
 *
 * The deterministic template in `zendesk-claim-template.ts` fills the factual
 * reference block (PO #, tracking, item, photos, link). This module takes that
 * template plus the operator's short "what happened" note and asks the local
 * Hermes model to rewrite it into a clearer, more professional subject + body
 * — the kind of ticket a vendor/3PL reads without follow-up questions.
 *
 * Discipline (mirrors `extract-llm.ts`):
 *   - local Hermes gateway only, temperature 0, forced single tool call;
 *   - the model rewrites PROSE only — it must NOT invent or alter facts
 *     (PO #, tracking, SKU, quantities stay exactly as given);
 *   - the result is a DRAFT: the operator reviews and edits it in the modal
 *     before the ticket is ever filed (Type A = low risk, human keeps the pen).
 */

import { hermesToolCall } from '@/lib/ai/hermes-tool-call';

const SYSTEM_PROMPT = [
  'You write professional support-ticket drafts for a warehouse receiving team.',
  'These tickets are filed with a vendor or 3PL via Zendesk to claim a problem',
  'with a received shipment (damage, missing units, wrong item, defect, etc.).',
  '',
  'You are given a factual TEMPLATE (already filled from our records) and the',
  "operator's short note about what happened. Rewrite them into a clean ticket.",
  '',
  'Rules:',
  '- NEVER invent, drop, or change facts. Keep every PO number, tracking number,',
  '  SKU, quantity, condition, link, and reference line exactly as in the template.',
  "- Expand the operator's shorthand into 1–3 clear, complete sentences describing",
  '  the problem. If the note is empty, write a neutral description from the',
  '  claim type and the factual lines — do not fabricate specifics.',
  '- Keep the structured reference block (the "Label: value" lines and the photos',
  '  / link lines) intact at the bottom of the body.',
  '- Tone: factual, neutral, and professional. This goes to an external vendor —',
  '  no blame, no slang, no internal jargon.',
  '- Subject: one concise line a support agent can scan (≤ ~90 chars). Keep the',
  '  PO and a short problem summary.',
  '',
  'Call the `report_claim_draft` tool exactly once and stop. Do not reply with prose.',
].join('\n');

const TOOL_NAME = 'report_claim_draft';

export interface ClaimDraftInput {
  claimTypeLabel: string;
  severityLabel: string;
  /** The deterministic template — authoritative facts the model must preserve. */
  template: { subject: string; description: string };
  /** Operator's raw "what happened" note (may be empty). */
  reason?: string;
}

export interface ClaimDraftResult {
  subject: string;
  description: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  };
}

interface DraftToolArgs {
  subject?: unknown;
  description?: unknown;
}

function buildUserText(input: ClaimDraftInput): string {
  const reason = String(input.reason ?? '').trim();
  return [
    `Claim type: ${input.claimTypeLabel}`,
    `Severity: ${input.severityLabel}`,
    '',
    "Operator's note (what happened):",
    reason || '(none provided)',
    '',
    '--- TEMPLATE SUBJECT (improve, keep the facts) ---',
    input.template.subject,
    '',
    '--- TEMPLATE BODY (rewrite the prose, keep the reference lines) ---',
    input.template.description,
  ].join('\n');
}

export async function draftClaimWithLlm(
  input: ClaimDraftInput,
): Promise<ClaimDraftResult> {
  const { args, model, usage } = await hermesToolCall<DraftToolArgs>({
    systemPrompt: SYSTEM_PROMPT,
    userText: buildUserText(input),
    maxTokens: 1200,
    tool: {
      name: TOOL_NAME,
      description: 'Report the rewritten claim ticket subject and body.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subject: {
            type: 'string',
            description: 'Concise, professional ticket subject (keeps the PO).',
          },
          description: {
            type: 'string',
            description:
              'Rewritten ticket body: clear problem prose + the intact reference block.',
          },
        },
        required: ['subject', 'description'],
      },
    },
  });

  const subject = typeof args.subject === 'string' ? args.subject.trim() : '';
  const description =
    typeof args.description === 'string' ? args.description.trim() : '';
  if (!subject || !description) {
    throw new Error(`Model "${model}" returned an empty subject or body`);
  }

  return { subject, description, model, usage };
}
