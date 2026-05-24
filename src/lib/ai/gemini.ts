/**
 * Gemini API REST Client
 * Zero-dependency helper for text embeddings and content generation
 */

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'models/text-embedding-004',
      content: {
        parts: [{ text }],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Embedding API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error('Invalid embedding response format from Gemini');
  }

  return values;
}

export async function getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  if (texts.length === 0) return [];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text }],
        },
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Batch Embedding API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings)) {
    throw new Error('Invalid batch embedding response format from Gemini');
  }

  return embeddings.map((emb: any, idx: number) => {
    const values = emb?.values;
    if (!Array.isArray(values)) {
      throw new Error(`Invalid embedding at index ${idx} in batch response`);
    }
    return values;
  });
}
