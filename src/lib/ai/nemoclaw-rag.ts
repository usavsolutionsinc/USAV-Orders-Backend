const NEMOCLAW_RAG_URL = (process.env.NEMOCLAW_RAG_URL || '').replace(/\/$/, '');

export interface RagChunk {
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface RagQueryResult {
  answer: string;
  chunks: RagChunk[];
  sources: string[];
}

/**
 * Query the NemoClaw RAG pipeline via Cloudflare tunnel.
 *
 * Routes through rag.michaelgarisek.com → WSL NemoClaw (:8765).
 * Retrieves from Qdrant, re-ranks with BM25 + RRF, then synthesises
 * via the configured model. 30s timeout for synthesis latency.
 */
export async function queryNemoClawRag(
  query: string,
  topK = 5,
): Promise<RagQueryResult> {
  if (!NEMOCLAW_RAG_URL) {
    throw new Error('NEMOCLAW_RAG_URL not configured');
  }

  const res = await fetch(`${NEMOCLAW_RAG_URL}/api/rag/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, top_k: topK }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`NemoClaw RAG error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();

  const rawChunks: RagChunk[] = data.chunks || data.results || [];
  const answer: string = data.answer || data.response || '';

  const sources = rawChunks
    .map((c) => {
      const src = c.metadata?.source;
      return typeof src === 'string' ? src : undefined;
    })
    .filter((s): s is string => !!s);

  return {
    answer,
    chunks: rawChunks,
    sources: [...new Set(sources)],
  };
}
