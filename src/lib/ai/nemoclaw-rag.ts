const NEMOCLAW_RAG_URL = process.env.NEMOCLAW_RAG_URL || 'http://127.0.0.1:8765';

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
 * Query the NemoClaw RAG pipeline.
 *
 * Sends the query to Qdrant for retrieval, BM25 + RRF re-ranking, then
 * Prometheus Mac Qwen2.5-32B synthesizes the answer. 30s timeout to allow
 * for Mac synthesis latency.
 */
export async function queryNemoClawRag(
  query: string,
  topK = 5,
): Promise<RagQueryResult> {
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

  // Normalize — NemoClaw may return `results` or `chunks`
  const rawChunks: RagChunk[] = data.chunks || data.results || [];
  const answer: string = data.answer || data.response || '';

  const sources = rawChunks
    .map((c) => {
      const src = c.metadata?.source;
      return typeof src === 'string' ? src : undefined;
    })
    .filter((s): s is string => !!s);

  // Deduplicate sources
  const uniqueSources = [...new Set(sources)];

  return {
    answer,
    chunks: rawChunks,
    sources: uniqueSources,
  };
}
