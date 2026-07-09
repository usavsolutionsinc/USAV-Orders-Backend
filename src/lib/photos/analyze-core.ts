/**
 * Photo-analysis orchestration — PURE wiring, no DB / no `server-only` imports, so
 * it unit-tests with zero database. The server bindings (DB context load, real
 * provider calls, persistence) live in `analyze.ts`, which injects them as Deps.
 *
 * analyzePhoto routes a photo to the provider THIS ORG chose (resolved upstream in
 * the context) and degrades to deterministic catalog metadata on any null — it
 * never throws on a missing model or an unreachable vision box.
 */

import type { PhotoAnalysisMetadata } from './analyze-types';
import type { PhotoAnalyzeProvider } from './analyze-provider';
import type { LocalVisionConfig } from './local-vision-client';

/** Deterministic, model-free metadata from PO context — the universal fallback. */
export function analyzeFromCatalog(input: {
  poRef: string | null;
  photoType: string | null;
}): PhotoAnalysisMetadata {
  const ocr = input.poRef ? [`PO ${input.poRef}`] : [];
  return {
    ocr_text: ocr,
    labels: [input.photoType || 'receiving'],
    damage_detected: false,
    damage_notes: null,
    caption: input.poRef ? `Photo for PO ${input.poRef}` : 'Operations photo',
  };
}

/** Everything analyzePhoto needs about a photo + how its org wants it run. */
export interface PhotoAnalyzeContext {
  poRef: string | null;
  photoType: string | null;
  entityType: string | null;
  provider: PhotoAnalyzeProvider;
  localVisionConfig: LocalVisionConfig | null;
}

/** Injectable collaborators — defaults (in analyze.ts) hit the real DB / providers. */
export interface AnalyzePhotoDeps {
  loadContext(photoId: number, organizationId: string): Promise<PhotoAnalyzeContext | null>;
  readBytes(
    photoId: number,
    organizationId: string,
  ): Promise<{ bytes: Uint8Array; filename: string } | null>;
  runHermes(input: {
    poRef: string | null;
    photoType: string | null;
    entityType: string | null;
  }): Promise<{ metadata: PhotoAnalysisMetadata; model: string } | null>;
  runGcpVision(buffer: Buffer): Promise<PhotoAnalysisMetadata | null>;
  runLocalVision(
    buffer: Buffer,
    config: LocalVisionConfig | null,
    filename: string,
  ): Promise<PhotoAnalysisMetadata | null>;
  persist(args: {
    photoId: number;
    organizationId: string;
    model: string;
    metadata: PhotoAnalysisMetadata;
  }): Promise<void>;
}

/**
 * Enrich one photo into `photo_analysis`, routing to the org's chosen provider.
 * Returns the metadata written. Throws only when the photo itself is missing.
 */
export async function analyzePhoto(
  input: { photoId: number; organizationId: string },
  deps: AnalyzePhotoDeps,
): Promise<PhotoAnalysisMetadata> {
  const ctx = await deps.loadContext(input.photoId, input.organizationId);
  if (!ctx) throw new Error('Photo not found');

  let metadata: PhotoAnalysisMetadata | null = null;
  let model = 'catalog-fallback';

  if (ctx.provider === 'local-vision') {
    const bytes = await deps.readBytes(input.photoId, input.organizationId);
    if (bytes) {
      metadata = await deps.runLocalVision(
        Buffer.from(bytes.bytes),
        ctx.localVisionConfig,
        bytes.filename,
      );
      if (metadata) model = 'local-vision';
    }
  } else if (ctx.provider === 'gcp-vision') {
    const bytes = await deps.readBytes(input.photoId, input.organizationId);
    if (bytes) metadata = await deps.runGcpVision(Buffer.from(bytes.bytes));
    if (metadata) model = 'gcp-vision';
  } else if (ctx.provider === 'hermes') {
    const hermes = await deps.runHermes({
      poRef: ctx.poRef,
      photoType: ctx.photoType,
      entityType: ctx.entityType,
    });
    if (hermes) {
      metadata = hermes.metadata;
      model = hermes.model;
    }
  }
  // provider === 'catalog' (or any null above) falls through to catalog fallback.

  if (!metadata) {
    metadata = analyzeFromCatalog({ poRef: ctx.poRef, photoType: ctx.photoType });
    model = 'catalog-fallback';
  }

  await deps.persist({
    photoId: input.photoId,
    organizationId: input.organizationId,
    model,
    metadata,
  });

  return metadata;
}
