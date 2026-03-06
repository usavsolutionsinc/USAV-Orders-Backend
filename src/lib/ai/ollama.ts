export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OllamaChatOptions = {
  model?: string;
  messages: OllamaMessage[];
  temperature?: number;
  format?: 'json';
  timeoutMs?: number;
};

export type OllamaChatResult = {
  content: string;
  model: string;
  done: boolean;
  totalDuration?: number;
  promptEvalCount?: number;
  evalCount?: number;
};

type OllamaResponse = {
  model?: string;
  done?: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  message?: {
    content?: string;
  };
  error?: string;
};

function getOllamaBaseUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_TUNNEL_URL || 'http://127.0.0.1:11434';
  return raw.replace(/\/$/, '');
}

function getDefaultModel(): string {
  return process.env.OLLAMA_MODEL || 'llama3.1:8b';
}

export async function chatWithOllama(options: OllamaChatOptions): Promise<OllamaChatResult> {
  const controller = new AbortController();
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : Number(process.env.OLLAMA_TIMEOUT_MS || 60000);

  const timeout = setTimeout(() => {
    controller.abort('Ollama request timed out');
  }, timeoutMs);

  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || getDefaultModel(),
        messages: options.messages,
        stream: false,
        options: {
          temperature: options.temperature,
        },
        format: options.format,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const rawText = await response.text();
    let payload: OllamaResponse = {};

    try {
      payload = rawText ? (JSON.parse(rawText) as OllamaResponse) : {};
    } catch {
      throw new Error(`Invalid Ollama response: ${rawText.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(payload.error || `Ollama request failed (${response.status})`);
    }

    const content = payload.message?.content?.trim() || '';
    if (!content) {
      throw new Error('Ollama returned an empty response');
    }

    return {
      content,
      model: payload.model || options.model || getDefaultModel(),
      done: Boolean(payload.done),
      totalDuration: payload.total_duration,
      promptEvalCount: payload.prompt_eval_count,
      evalCount: payload.eval_count,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function pingOllama(): Promise<{ ok: boolean; model?: string; message?: string }> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      return { ok: false, message: `Ollama tags request failed (${response.status})` };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      models?: Array<{ name?: string }>;
    };

    const defaultModel = getDefaultModel();
    const found = payload.models?.find((model) => model?.name === defaultModel);

    return {
      ok: true,
      model: found?.name || payload.models?.[0]?.name || defaultModel,
      message: found ? 'default model available' : 'ollama reachable',
    };
  } catch (error: any) {
    return {
      ok: false,
      message: error?.message || 'Failed to reach Ollama',
    };
  }
}
