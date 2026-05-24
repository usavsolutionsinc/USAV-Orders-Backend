-- Create vector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create rag_documents table
CREATE TABLE IF NOT EXISTS "rag_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  "file_name" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text NOT NULL,
  "file_path" text NOT NULL,
  "chunk_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Create rag_document_chunks table
CREATE TABLE IF NOT EXISTS "rag_document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "rag_documents"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  "text" text NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "chunk_index" integer NOT NULL
);

-- Indexes for performance and multi-tenancy
CREATE INDEX IF NOT EXISTS "idx_rag_documents_organization_id" ON "rag_documents"("organization_id");
CREATE INDEX IF NOT EXISTS "idx_rag_document_chunks_organization_id" ON "rag_document_chunks"("organization_id");
CREATE INDEX IF NOT EXISTS "idx_rag_document_chunks_document_id" ON "rag_document_chunks"("document_id");

-- Create HNSW index on the embedding vector for efficient cosine similarity search
CREATE INDEX IF NOT EXISTS "idx_rag_document_chunks_embedding" ON "rag_document_chunks" USING hnsw (embedding vector_cosine_ops);
