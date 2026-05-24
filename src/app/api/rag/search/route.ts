import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getEmbedding } from '@/lib/ai/gemini';
import { tenantQuery } from '@/lib/tenancy/db';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { query, limit = 5 } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: 'Query string is required' }, { status: 400 });
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 20));

    // 1. Generate text embedding for search term using text-embedding-004
    console.log(`[RAG/search] Generating embedding for query: "${query}"`);
    const queryEmbedding = await getEmbedding(query);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // 2. Perform cosine similarity lookup using pgvector operator <=> (cosine distance)
    // 1 - (embedding <=> queryEmbedding) = cosine similarity
    const result = await tenantQuery<{ text: string; similarity: number }>(
      ctx.organizationId,
      `SELECT text, 1 - (embedding <=> $1::vector) AS similarity 
       FROM rag_document_chunks 
       WHERE organization_id = $2 
       ORDER BY embedding <=> $1::vector 
       LIMIT $3`,
      [vectorStr, ctx.organizationId, safeLimit]
    );

    return NextResponse.json({
      success: true,
      query,
      results: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error('[RAG/search] Similarity search failed:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: error.message }, { status: 500 });
  }
});
