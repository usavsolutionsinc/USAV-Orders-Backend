import pool from '@/lib/db';
import { photoContentUrl } from '../display-url';

export interface PhotoSearchFilters {
  organizationId: string;
  poRef?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  damageDetected?: boolean | null;
  q?: string | null;
  limit?: number;
}

export interface PhotoSearchResult {
  id: number;
  poRef: string | null;
  photoType: string | null;
  createdAt: string;
  thumbUrl: string;
  damageDetected: boolean | null;
  caption: string | null;
}

/** SQL-first photo search for Hermes context + library q= filter. */
export async function searchPhotos(filters: PhotoSearchFilters): Promise<PhotoSearchResult[]> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const params: unknown[] = [filters.organizationId];
  const clauses = ['p.organization_id = $1'];

  if (filters.poRef) {
    params.push(`%${filters.poRef}%`);
    clauses.push(`p.po_ref ILIKE $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    clauses.push(`p.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    clauses.push(`p.created_at <= $${params.length}::timestamptz`);
  }
  if (filters.damageDetected === true) {
    clauses.push(`(a.metadata->>'damage_detected')::boolean IS TRUE`);
  } else if (filters.damageDetected === false) {
    clauses.push(`(a.metadata->>'damage_detected')::boolean IS NOT TRUE`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const qParam = `$${params.length}`;
    clauses.push(`(
      p.po_ref ILIKE ${qParam}
      OR a.metadata::text ILIKE ${qParam}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(a.metadata->'ocr_text', '[]'::jsonb)) t
        WHERE t ILIKE ${qParam}
      )
    )`);
  }

  params.push(limit);
  const res = await pool.query<{
    id: string;
    po_ref: string | null;
    photo_type: string | null;
    created_at: string;
    damage_detected: boolean | null;
    caption: string | null;
  }>(
    `SELECT p.id, p.po_ref, p.photo_type, p.created_at,
            (a.metadata->>'damage_detected')::boolean AS damage_detected,
            a.metadata->>'caption' AS caption
       FROM photos p
       LEFT JOIN photo_analysis a ON a.photo_id = p.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    poRef: r.po_ref,
    photoType: r.photo_type,
    createdAt: r.created_at,
    thumbUrl: photoContentUrl(Number(r.id), 'thumb'),
    damageDetected: r.damage_detected,
    caption: r.caption,
  }));
}

export function formatPhotoSearchForPrompt(rows: PhotoSearchResult[]): string {
  if (rows.length === 0) return '=== PHOTOS ===\nNo photos matched.';
  return [
    '=== PHOTOS ===',
    ...rows.map((r) => {
      const parts = [
        `id=${r.id}`,
        r.poRef ? `po=${r.poRef}` : null,
        r.photoType ? `type=${r.photoType}` : null,
        r.damageDetected ? 'damage=yes' : null,
        r.caption ? `caption=${r.caption}` : null,
        `at=${r.createdAt}`,
      ].filter(Boolean);
      return `  ${parts.join(' | ')}`;
    }),
  ].join('\n');
}
