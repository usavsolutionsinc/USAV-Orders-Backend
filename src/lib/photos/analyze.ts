import pool from '@/lib/db';
import { readPhotoBytesById } from './read-bytes';
import { hermesToolCall } from '@/lib/ai/hermes-tool-call';
import { getHermesApiUrl } from '@/lib/ai/hermes-client';

export interface PhotoAnalysisMetadata {
  ocr_text: string[];
  labels: string[];
  damage_detected: boolean;
  damage_notes: string | null;
  caption: string;
}

const DAMAGE_KEYWORDS = ['damage', 'damaged', 'tear', 'dent', 'crack', 'broken', 'crumpled'];

export type PhotoAnalyzeProvider = 'hermes' | 'vision' | 'catalog';

/** Off unless PHOTOS_ANALYZE_ENABLED=true. */
export function isAnalyzeEnabled(): boolean {
  return (process.env.PHOTOS_ANALYZE_ENABLED || 'false').toLowerCase() === 'true';
}

/** Off unless PHOTOS_ANALYZE_ON_UPLOAD=true. */
export function isAnalyzeOnUploadEnabled(): boolean {
  return (process.env.PHOTOS_ANALYZE_ON_UPLOAD || 'false').toLowerCase() === 'true';
}

export function getAnalyzeProvider(): PhotoAnalyzeProvider {
  const raw = (process.env.PHOTOS_ANALYZE_PROVIDER || 'hermes').toLowerCase();
  if (raw === 'vision' || raw === 'catalog') return raw;
  return 'hermes';
}

function isGcpVisionConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ||
      process.env.PHOTOS_GCS_PROJECT_ID?.trim(),
  );
}

async function analyzeWithVision(buffer: Buffer): Promise<PhotoAnalysisMetadata | null> {
  if (!isGcpVisionConfigured()) return null;
  try {
    const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vision = require('@google-cloud/vision') as typeof import('@google-cloud/vision');
    const client = json
      ? new vision.ImageAnnotatorClient({
          credentials: JSON.parse(json),
          projectId: process.env.PHOTOS_GCS_PROJECT_ID,
        })
      : new vision.ImageAnnotatorClient({ projectId: process.env.PHOTOS_GCS_PROJECT_ID });

    const [labelResult, textResult] = await Promise.all([
      client.labelDetection({ image: { content: buffer } }),
      client.textDetection({ image: { content: buffer } }),
    ]);

    const labels = (labelResult[0].labelAnnotations ?? [])
      .map((l) => l.description?.toLowerCase())
      .filter((l): l is string => Boolean(l))
      .slice(0, 12);

    const ocrChunks: string[] = [];
    const fullText = textResult[0].fullTextAnnotation?.text;
    if (fullText) {
      for (const line of fullText.split('\n').map((s) => s.trim()).filter(Boolean)) {
        if (line.length >= 3) ocrChunks.push(line.slice(0, 120));
      }
    }

    const damageLabels = labels.filter((l) => DAMAGE_KEYWORDS.some((d) => l.includes(d)));
    const damageDetected = damageLabels.length > 0;

    return {
      ocr_text: ocrChunks.slice(0, 20),
      labels,
      damage_detected: damageDetected,
      damage_notes: damageDetected ? damageLabels.join(', ') : null,
      caption: [labels.slice(0, 3).join(', ') || 'product photo', ocrChunks[0]]
        .filter(Boolean)
        .join(' · '),
    };
  } catch (err) {
    console.warn('[photo-analyze] gcp vision failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function analyzeWithHermes(input: {
  poRef: string | null;
  photoType: string | null;
  entityType: string | null;
}): Promise<{ metadata: PhotoAnalysisMetadata; model: string } | null> {
  if (!getHermesApiUrl()) return null;

  try {
    const { args, model } = await hermesToolCall<PhotoAnalysisMetadata>({
      systemPrompt:
        'You enrich USAV warehouse photo catalog metadata for search. ' +
        'Infer likely OCR snippets, scene labels, and visible damage from PO context and photo type. ' +
        'Be conservative on damage_detected — only true when context strongly suggests damage/claim.',
      userText: [
        `PO reference: ${input.poRef || 'unknown'}`,
        `Photo type: ${input.photoType || 'receiving'}`,
        `Entity: ${input.entityType || 'RECEIVING'}`,
      ].join('\n'),
      tool: {
        name: 'photo_analysis_metadata',
        description: 'Structured photo catalog enrichment for SQL search',
        parameters: {
          type: 'object',
          properties: {
            ocr_text: { type: 'array', items: { type: 'string' } },
            labels: { type: 'array', items: { type: 'string' } },
            damage_detected: { type: 'boolean' },
            damage_notes: { type: ['string', 'null'] },
            caption: { type: 'string' },
          },
          required: ['ocr_text', 'labels', 'damage_detected', 'caption'],
        },
      },
    });

    return {
      metadata: {
        ocr_text: Array.isArray(args.ocr_text) ? args.ocr_text.slice(0, 20) : [],
        labels: Array.isArray(args.labels) ? args.labels.slice(0, 12) : [],
        damage_detected: Boolean(args.damage_detected),
        damage_notes: args.damage_notes ?? null,
        caption: String(args.caption || 'Operations photo'),
      },
      model: `hermes:${model}`,
    };
  } catch (err) {
    console.warn('[photo-analyze] hermes failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

function analyzeFromCatalog(input: {
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

export async function analyzePhoto(input: {
  photoId: number;
  organizationId: string;
}): Promise<PhotoAnalysisMetadata> {
  const photoRes = await pool.query<{
    po_ref: string | null;
    photo_type: string | null;
    entity_type: string | null;
  }>(
    `SELECT p.po_ref, p.photo_type,
            (SELECT l.entity_type FROM photo_entity_links l
              WHERE l.photo_id = p.id AND l.link_role = 'primary'
              ORDER BY l.id ASC LIMIT 1) AS entity_type
       FROM photos p WHERE p.id = $1 AND p.organization_id = $2`,
    [input.photoId, input.organizationId],
  );
  const row = photoRes.rows[0];
  if (!row) throw new Error('Photo not found');

  const provider = getAnalyzeProvider();
  let metadata: PhotoAnalysisMetadata | null = null;
  let model = 'catalog-fallback';

  if (provider === 'vision') {
    const bytes = await readPhotoBytesById(input.photoId, input.organizationId);
    if (bytes) metadata = await analyzeWithVision(Buffer.from(bytes.bytes));
    if (metadata) model = 'gcp-vision';
  } else if (provider === 'hermes') {
    const hermes = await analyzeWithHermes({
      poRef: row.po_ref,
      photoType: row.photo_type,
      entityType: row.entity_type,
    });
    if (hermes) {
      metadata = hermes.metadata;
      model = hermes.model;
    }
  }

  if (!metadata) {
    metadata = analyzeFromCatalog({
      poRef: row.po_ref,
      photoType: row.photo_type,
    });
    model = 'catalog-fallback';
  }

  // Archive prior enrichment before replacing the latest row (skip if migration pending).
  try {
    await pool.query(
      `INSERT INTO photo_analysis_runs (photo_id, organization_id, model, metadata, analyzed_at)
       SELECT a.photo_id, a.organization_id, a.model, a.metadata, a.analyzed_at
         FROM photo_analysis a
        WHERE a.photo_id = $1`,
      [input.photoId],
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== '42P01') throw err;
  }

  await pool.query(
    `INSERT INTO photo_analysis (photo_id, organization_id, model, metadata, analyzed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (photo_id) DO UPDATE
       SET model = EXCLUDED.model,
           metadata = EXCLUDED.metadata,
           analyzed_at = NOW(),
           error_message = NULL`,
    [input.photoId, input.organizationId, model, JSON.stringify(metadata)],
  );

  return metadata;
}

export async function runAnalyzeJob(job: {
  id: number;
  photoId: number;
  organizationId: string;
}): Promise<void> {
  if (!isAnalyzeEnabled()) {
    throw new Error('Photo analysis is disabled (PHOTOS_ANALYZE_ENABLED=false)');
  }
  await analyzePhoto({ photoId: job.photoId, organizationId: job.organizationId });
}
