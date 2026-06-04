/**
 * LLM-backed field extraction for PO emails (Phase 4 of PO mailbox triage).
 *
 * Local-only: posts to the Hermes gateway (OpenAI-compatible) on
 * HERMES_API_URL with the model named in AI_MODEL (defaults to
 * `gemma-4-e4b`). No cloud fallback — if the gateway is down or the
 * model returns invalid output, the operator sees a clear error and can
 * retry once Hermes is back up.
 *
 * The function ALWAYS marks results as low-trust at the consumer side
 * (the checklist UI requires explicit confirmation per field). The model
 * also self-rates confidence per field; we surface that without acting
 * on it ourselves.
 *
 * No SDK dep — plain fetch against the OpenAI Chat Completions endpoint
 * the Hermes gateway exposes. The tool definition uses OpenAI's `tools`
 * + `tool_choice` shape, which gemma-4-e4b and other tool-calling-capable
 * local models honor.
 */

// Default model when AI_MODEL isn't set. Gemma 4 e4B has explicit tool-call
// support + reasoning, which gives the most disciplined arg adherence we
// can get from a sub-5GB local model. Swap by setting AI_MODEL in env;
// the runtime verifies the model is loaded in the Hermes runtime on call.
const DEFAULT_AI_MODEL = 'gemma-4-e4b';

const SYSTEM_PROMPT = [
  'You extract purchase-order fields from vendor emails into a strict schema.',
  '',
  'Rules:',
  '- Only return fields you actually find. Omit fields entirely if absent.',
  '- Never invent values. If the email mentions "see attached PDF" and the',
  '  field is only in the attachment, omit it.',
  '- Dates must be ISO 8601 (YYYY-MM-DD). Convert "May 19, 2026" → "2026-05-19".',
  '- Totals must be numeric strings with no currency symbol or thousands',
  '  separators. Put the currency code in the `currency` field (USD, CAD, EUR).',
  '- Vendor is the *sender company*, not the buyer or ship-to. Strip suffixes',
  '  like "Inc.", "LLC." only if obviously decorative.',
  '- ship_to is a single freeform string — combine name + address lines with',
  '  commas.',
  '- line_items_count is the count of distinct SKUs/products in the order,',
  '  not total units.',
  '- Confidence values:',
  '    high   = stated explicitly with a clear label ("Total: $4,820.00")',
  '    medium = inferred from layout/context (e.g. last $-amount line)',
  '    low    = guessed from partial info',
  '- triage_pile suggests where this email belongs:',
  '    upload = a genuine purchase order to enter into Zoho — it has a PO#,',
  '             line items, a vendor, or clear order/confirmation language.',
  '    ignore = clearly not a PO to enter — marketing, a newsletter, a shipping',
  '             or delivery notification, a plain receipt, or an obvious duplicate.',
  '    inbox  = you genuinely cannot tell; leave it for a human to triage.',
  '  Only choose upload or ignore at high/medium confidence. When unsure, return',
  '  inbox. This is only a suggestion — a human confirms before the email moves.',
  '',
  'Call the `report_extracted_fields` tool exactly once and stop. Do not',
  'reply with prose.',
].join('\n');

const TOOL_NAME = 'report_extracted_fields';

const REPORT_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description:
      'Report purchase-order fields extracted from the email body.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vendor: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        po_date: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string', description: 'ISO date YYYY-MM-DD' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        total: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string', description: 'Numeric string, no symbols' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        currency: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string', description: 'ISO 4217 code: USD, CAD, EUR…' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        line_items_count: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'integer', minimum: 0 },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        ship_to: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
        triage_pile: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: {
              type: 'string',
              enum: ['upload', 'ignore', 'inbox'],
              description: 'Suggested triage pile for this email',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['value', 'confidence'],
        },
      },
    },
  },
} as const;

export interface LlmFieldResult {
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Triage piles the model is allowed to suggest (omits the terminal `done`). */
export type LlmTriagePile = 'upload' | 'ignore' | 'inbox';

export interface LlmPileResult {
  value: LlmTriagePile;
  confidence: 'high' | 'medium' | 'low';
}

export interface LlmExtractedFields {
  vendor?: LlmFieldResult;
  po_date?: LlmFieldResult;
  total?: LlmFieldResult;
  currency?: LlmFieldResult;
  line_items_count?: LlmFieldResult;
  ship_to?: LlmFieldResult;
  /** Suggested triage pile (advisory only; a human confirms the move). */
  triage_pile?: LlmPileResult;
}

export interface ExtractWithLlmInput {
  subject: string;
  from: string;
  bodyText: string;
  /** PO numbers the regex extractor already found, passed as context. */
  knownPoNumbers?: string[];
}

export interface ExtractWithLlmResult {
  fields: LlmExtractedFields;
  /** Model id reported by the Hermes runtime (or the env default if omitted). */
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    /** Always 0 for the local Hermes path — kept for API stability. */
    cache_read_input_tokens: number;
  };
}

// Long emails can blow context cheaply with no extraction benefit. 12k
// chars is roughly 3k tokens of body — enough for any real PO email.
const MAX_BODY_CHARS = 12_000;

function buildUserText(input: ExtractWithLlmInput): string {
  const body =
    input.bodyText.length > MAX_BODY_CHARS
      ? input.bodyText.slice(0, MAX_BODY_CHARS) + '\n\n[…truncated]'
      : input.bodyText;
  return [
    `From: ${input.from}`,
    `Subject: ${input.subject}`,
    input.knownPoNumbers?.length
      ? `PO numbers detected by regex: ${input.knownPoNumbers.join(', ')}`
      : null,
    '',
    '--- Email body ---',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string } | string;
}

export async function extractWithLlm(
  input: ExtractWithLlmInput,
): Promise<ExtractWithLlmResult> {
  const baseUrl = String(process.env.HERMES_API_URL ?? '').trim();
  if (!baseUrl) {
    throw new Error(
      'HERMES_API_URL is not set; cannot reach the local AI gateway',
    );
  }
  const apiKey = String(process.env.HERMES_API_KEY ?? '').trim();
  const model = String(process.env.AI_MODEL ?? DEFAULT_AI_MODEL).trim();

  const requestBody = {
    model,
    // temperature=0 nails down extraction determinism — small local models
    // hallucinate tool args far less when sampling is turned off.
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserText(input) },
    ],
    tools: [REPORT_TOOL],
    // Force the tool — without this, small models occasionally answer
    // with prose ("Sure! Here's what I found:") instead of calling the tool.
    tool_choice: { type: 'function', function: { name: TOOL_NAME } },
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = (await res.json()) as OpenAiChatResponse;

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    // Some local models emit JSON in `content` instead of a tool call.
    // Surface a clean error so the operator knows to re-run or pick a
    // different model rather than silently dropping the extraction.
    throw new Error(
      `Model "${model}" did not return a ${TOOL_NAME} tool call`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    throw new Error(
      `Model "${model}" returned invalid JSON in tool args: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    );
  }

  return {
    fields: parsed as LlmExtractedFields,
    model: data.model ?? model,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
    },
  };
}
