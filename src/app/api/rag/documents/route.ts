import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { chunkText, parseDocumentContent } from '@/lib/rag/parser';
import { getEmbeddingsBatch } from '@/lib/ai/gemini';
import { withTenantTransaction } from '@/lib/tenancy/db';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    let fileName = '';
    let mimeType = '';
    let fileSize = 0;
    let fileContent = '';

    // Inspect request contentType
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      if (!file) {
        return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
      }
      fileName = file.name;
      mimeType = file.type || 'text/plain';
      fileSize = file.size;
      fileContent = await file.text();
    } else {
      // JSON payload fallback
      const body = await req.json().catch(() => ({}));
      fileName = body.fileName || 'document.txt';
      mimeType = body.mimeType || 'text/plain';
      fileContent = body.fileContent || '';
      fileSize = Buffer.byteLength(fileContent, 'utf8');
    }

    if (!fileContent.trim()) {
      return NextResponse.json({ error: 'File content is empty' }, { status: 400 });
    }

    // 1. Clean and parse content based on mimeType
    const parsedText = parseDocumentContent(fileContent, mimeType);

    // 2. Split text into sliding-window chunks
    const chunks = chunkText(parsedText, 2000, 200);
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No valid chunks generated from file content' }, { status: 400 });
    }

    // 3. Batch generate vector embeddings from Gemini (text-embedding-004)
    console.log(`[RAG] Generating embeddings for ${chunks.length} chunks of document "${fileName}"...`);
    const embeddings = await getEmbeddingsBatch(chunks);

    // 4. Insert both document and chunks inside a single tenant-isolated transaction
    const virtualPath = `virtual://rag/${ctx.organizationId}/${Date.now()}-${encodeURIComponent(fileName)}`;

    let documentId = '';
    await withTenantTransaction(ctx.organizationId, async (client) => {
      const docResult = await client.query(
        `INSERT INTO rag_documents (
          organization_id, file_name, file_size, mime_type, file_path, chunk_count, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING id`,
        [ctx.organizationId, fileName, fileSize, mimeType, virtualPath, chunks.length, 'completed']
      );
      documentId = docResult.rows[0].id;

      for (let i = 0; i < chunks.length; i++) {
        const textChunk = chunks[i];
        const embedding = embeddings[i];
        const vectorStr = `[${embedding.join(',')}]`;

        await client.query(
          `INSERT INTO rag_document_chunks (
            document_id, organization_id, text, embedding, chunk_index
          )
          VALUES ($1, $2, $3, $4::vector, $5)`,
          [documentId, ctx.organizationId, textChunk, vectorStr, i]
        );
      }
    });

    return NextResponse.json({
      success: true,
      documentId,
      fileName,
      chunkCount: chunks.length,
    });
  } catch (error: any) {
    console.error('[RAG/documents] Upload and index failed:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: error.message }, { status: 500 });
  }
});
