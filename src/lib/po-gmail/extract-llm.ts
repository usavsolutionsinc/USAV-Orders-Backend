/**
 * LLM-backed field extraction for PO emails (Phase 4 of PO mailbox triage).
 *
 * Why: the regex extractor in `extract.ts` reliably catches PO numbers but
 * can't read line items, totals, vendor names, ship-to, or PO dates from
 * free-form vendor emails. We delegate those to Claude Haiku 4.5 — small,
 * fast, cheap, and with prompt caching on the schema/system prompt to
 * keep cost flat across calls.
 *
 * The function ALWAYS marks results as low-trust at the consumer side
 * (the checklist UI requires explicit confirmation per field). The model
 * also self-rates confidence per field; we surface that without acting on
 * it ourselves.
 *
 * No SDK dep — plain fetch against api.anthropic.com to keep the
 * dependency surface small. Swap to @anthropic-ai/sdk if we add more
 * Claude features.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Haiku 4.5 — newest small model. Cheap + fast extraction. Bump to Sonnet
// if accuracy on real vendor emails proves insufficient.
const MODEL_ID = 'claude-haiku-4-5-20251001';

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
  '',
  'Call the `report_extracted_fields` tool exactly once and stop. Do not',
  'reply with prose.',
].join('\n');

const REPORT_TOOL = {
  name: 'report_extracted_fields',
  description: 'Report purchase-order fields extracted from the email body.',
  input_schema: {
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
    },
  },
} as const;

export interface LlmFieldResult {
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface LlmExtractedFields {
  vendor?: LlmFieldResult;
  po_date?: LlmFieldResult;
  total?: LlmFieldResult;
  currency?: LlmFieldResult;
  line_items_count?: LlmFieldResult;
  ship_to?: LlmFieldResult;
}

interface AnthropicResponse {
  id: string;
  content: Array<{
    type: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
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
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
  };
}

// Long emails can blow context cheaply with no extraction benefit. 12k
// chars is roughly 3k tokens of body — enough for any real PO email.
const MAX_BODY_CHARS = 12_000;

export async function extractWithLlm(input: ExtractWithLlmInput): Promise<ExtractWithLlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set; AI extraction is disabled');
  }

  const body =
    input.bodyText.length > MAX_BODY_CHARS
      ? input.bodyText.slice(0, MAX_BODY_CHARS) + '\n\n[…truncated]'
      : input.bodyText;

  const userText = [
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

  // cache_control on the system prompt + tool definition lets Anthropic
  // reuse the parsed prefix on subsequent calls within ~5 minutes, which
  // is most of our spend on this endpoint.
  const requestBody = {
    model: MODEL_ID,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: REPORT_TOOL.name },
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userText }],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as AnthropicResponse;

  const toolUse = data.content.find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL.name);
  if (!toolUse || !toolUse.input) {
    throw new Error('LLM did not call report_extracted_fields tool');
  }

  return {
    fields: toolUse.input as LlmExtractedFields,
    usage: {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
    },
  };
}
