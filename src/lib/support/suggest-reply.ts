import 'server-only';
import { queryNemoClawRag, type RagQueryResult } from '@/lib/ai/nemoclaw-rag';
import { getHermesApiUrl, getHermesHeaders, getHermesModel } from '@/lib/ai/hermes-client';

/**
 * Local-model support-reply suggester.
 *
 * Grounds the customer's question in the Bose document RAG (NemoClaw, via
 * {@link queryNemoClawRag}) and composes a draft reply with the local Hermes
 * gateway. This is the "local" provider of the support-suggestion feature; a
 * cloud sibling can implement the same {@link SupportSuggestion} contract later
 * and be selected per-org (mirrors the photo_analysis provider pattern).
 *
 * Pure-ish + DI: collaborators are injected via {@link SuggestDeps} (defaulting
 * to the real RAG + Hermes calls) so unit tests run with zero network — per the
 * backend Deps-injection rule.
 */

export type SuggestionConfidence = 'high' | 'medium' | 'low';

export interface SupportSuggestionInput {
  ticketId: number;
  /** Ticket subject, for light framing (optional). */
  subject?: string;
  /** The customer's latest message — the thing we are drafting a reply to. */
  question: string;
}

export interface SupportSuggestion {
  suggestion: string;
  sources: string[];
  confidence: SuggestionConfidence;
  mode: 'local';
  model: string;
  /** Whether the Bose RAG returned usable grounding for this question. */
  grounded: boolean;
}

/** Injectable collaborators so this is unit-testable with zero network. */
export interface SuggestDeps {
  queryRag: (query: string, topK?: number) => Promise<RagQueryResult>;
  generate: (prompt: { system: string; user: string; sessionTag: string }) => Promise<string>;
}

export class SupportSuggestError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'SupportSuggestError';
    this.status = status;
    this.detail = detail;
  }
}

const SUPPORT_SYSTEM_PROMPT =
  'You are a senior customer-support agent for a Bose audio reseller. ' +
  'Draft a concise, friendly, accurate reply to the customer using ONLY the ' +
  'grounding facts provided. Be specific and actionable in 2-5 short sentences. ' +
  'If the grounding does not cover the question, say what you can confirm and ' +
  'offer a clear next step. Never invent model numbers, specs, prices, or policies.';

/** Default real generation call — the local Hermes OpenAI-compatible gateway. */
async function defaultGenerate({
  system,
  user,
  sessionTag,
}: {
  system: string;
  user: string;
  sessionTag: string;
}): Promise<string> {
  const res = await fetch(`${getHermesApiUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHermesHeaders({
      'Content-Type': 'application/json',
      'X-Hermes-Session-Id': sessionTag,
      'X-Source': 'usav-support-suggest',
    }),
    body: JSON.stringify({
      model: getHermesModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new SupportSuggestError(
      502,
      `Local AI returned ${res.status}. Is the hermes-gateway running?`,
      errBody.slice(0, 300),
    );
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || data?.reply || '';
  // Strip <think>...</think> reasoning blocks if the model includes them (mirrors /api/ai/chat).
  return String(raw).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const defaultDeps: SuggestDeps = {
  queryRag: queryNemoClawRag,
  generate: defaultGenerate,
};

function scoreToConfidence(topScore: number | undefined): SuggestionConfidence {
  if (typeof topScore !== 'number') return 'medium';
  if (topScore >= 0.7) return 'high';
  if (topScore >= 0.4) return 'medium';
  return 'low';
}

export async function suggestSupportReply(
  input: SupportSuggestionInput,
  deps: SuggestDeps = defaultDeps,
): Promise<SupportSuggestion> {
  const question = input.question.trim();
  if (!question) throw new SupportSuggestError(400, 'question is required');

  // 1. Ground in the Bose document RAG — best-effort. A RAG failure degrades to
  //    an ungrounded draft instead of failing the whole request.
  let rag: RagQueryResult | null = null;
  try {
    rag = await deps.queryRag(question, 5);
  } catch {
    rag = null;
  }

  const grounded = Boolean(rag?.answer?.trim());
  const groundingBlock = grounded
    ? `Grounding facts from Bose service documents:\n${rag!.answer}`
    : 'No specific Bose document grounding was found for this question.';

  const subjectLine = input.subject ? `Ticket subject: ${input.subject}\n` : '';
  const user =
    `${subjectLine}Customer message:\n${question}\n\n${groundingBlock}\n\n` +
    'Write the suggested reply now.';

  // 2. Compose the reply with the local model.
  const suggestion = await deps.generate({
    system: SUPPORT_SYSTEM_PROMPT,
    user,
    sessionTag: `support-ticket-${input.ticketId}`,
  });

  if (!suggestion) throw new SupportSuggestError(502, 'Local AI returned an empty suggestion.');

  return {
    suggestion,
    sources: rag?.sources ?? [],
    confidence: grounded ? scoreToConfidence(rag?.chunks?.[0]?.score) : 'low',
    mode: 'local',
    model: getHermesModel(),
    grounded,
  };
}
