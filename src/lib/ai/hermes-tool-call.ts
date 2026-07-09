/**
 * Shared forced-tool-call against the local Hermes gateway.
 *
 * Generalizes the proven pattern in `src/lib/po-gmail/extract-llm.ts`: a
 * single OpenAI-style chat-completions request that FORCES one tool call
 * (`tool_choice`), runs at `temperature: 0`, and returns the parsed tool
 * arguments. Local-only — posts to HERMES_API_URL with the model named in
 * AI_MODEL (default `gemma-4-e4b`). No cloud fallback: if the gateway is
 * down or the model returns invalid output, the caller gets a clear error.
 *
 * Every "agent does work" feature (PO extraction, claim drafting, …) should
 * route through here so the gateway plumbing lives in exactly one place. The
 * caller owns the system prompt, the tool schema, and how it interprets the
 * returned args.
 */

import { getHermesApiUrl, getHermesHeaders, getHermesModel } from '@/lib/ai/hermes-client';

// Default model when AI_MODEL isn't set — Gemma 4 e4B has explicit tool-call
// support, the most disciplined arg adherence we get from a sub-5GB local
// model. Swap by setting AI_MODEL; the Hermes runtime verifies it's loaded.
const DEFAULT_AI_MODEL = 'gemma-4-e4b';

export interface HermesTool {
  /** Tool name the model must call. */
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (OpenAI `function.parameters` shape). */
  parameters: Record<string, unknown>;
}

export interface HermesToolCallInput {
  systemPrompt: string;
  userText: string;
  tool: HermesTool;
  /** Defaults to 0 — determinism nails down small-model tool adherence. */
  temperature?: number;
  /** Defaults to 1024. */
  maxTokens?: number;
  /**
   * Optional provider override (AI search Phase 1): pass the resolved config
   * from `resolveAiConfig('chat')` (src/lib/ai/provider.ts) to route this
   * call through the capability-keyed provider layer (Vercel AI Gateway in
   * prod) instead of the legacy Hermes env vars. Same OpenAI wire format
   * either way — this stays the one forced-tool-call implementation.
   */
  provider?: { baseURL: string; apiKey?: string; model?: string };
}

export interface HermesToolCallResult<T> {
  /** Parsed (but NOT validated) tool arguments — the caller owns validation. */
  args: T;
  /** Model id reported by the runtime (or the env default if omitted). */
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    /** Always 0 for the local Hermes path — kept for API stability. */
    cache_read_input_tokens: number;
  };
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

export async function hermesToolCall<T = unknown>(
  input: HermesToolCallInput,
): Promise<HermesToolCallResult<T>> {
  const baseUrl = input.provider?.baseURL?.replace(/\/$/, '') || getHermesApiUrl();
  if (!baseUrl) {
    throw new Error('HERMES_API_URL is not set; cannot reach the local AI gateway');
  }
  const model = input.provider?.model || getHermesModel(DEFAULT_AI_MODEL);

  const requestBody = {
    model,
    temperature: input.temperature ?? 0,
    max_tokens: input.maxTokens ?? 1024,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userText },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: input.tool.name,
          description: input.tool.description,
          parameters: input.tool.parameters,
        },
      },
    ],
    // Force a tool call — without this, small models occasionally answer with
    // prose ("Sure! Here's what I found:") instead of calling the tool. We send
    // exactly one tool, so `"required"` forces *that* tool. We use the string
    // form (not `{type:'function',function:{name}}`) because it's portable:
    // LM Studio only accepts none|auto|required, while OpenAI-compatible
    // gateways accept "required" too.
    tool_choice: 'required',
  };

  const headers: HeadersInit = input.provider
    ? {
        'content-type': 'application/json',
        ...(input.provider.apiKey ? { Authorization: `Bearer ${input.provider.apiKey}` } : {}),
      }
    : getHermesHeaders({
        'content-type': 'application/json',
      });
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    throw new Error(`AI gateway ${res.status}: ${text}`);
  }
  const data = (await res.json()) as OpenAiChatResponse;

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    throw new Error(`Model "${model}" did not return a ${input.tool.name} tool call`);
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
    args: parsed as T,
    model: data.model ?? model,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
    },
  };
}
