import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

/**
 * Receiving photo endpoint.
 *
 * Photos are stored polymorphically on the `photos` table — same pattern used
 * for PACKER_LOG, SKU, BIN_ADJUSTMENT, etc.:
 *   PO-level photo   → entity_type='RECEIVING',      entity_id=receiving.id
 *   Item-level photo → entity_type='RECEIVING_LINE', entity_id=receiving_lines.id
 *
 * The POST body still talks in `receivingId` / `receivingLineId` because that's
 * how the mobile client thinks of scope; we translate to (entity_type,
 * entity_id) on insert and back to (receivingId, receivingLineId) on read.
 *
 * GET parameters:
 *   ?receivingId=N&receivingLineId=M → only that item's photos
 *   ?receivingId=N&scope=po          → only PO-level photos
 *   ?receivingId=N                   → every photo for the PO (PO-level
 *                                       UNION item-level on every line under N)
 */

interface PhotoRow {
  id: number;
  receivingId: number | null;
  receivingLineId: number | null;
  photoUrl: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

interface DbRow {
  id: number;
  entity_type: string;
  entity_id: number;
  receiving_id_resolved: number | null;
  url: string;
  caption: string | null;
  uploaded_by: number | null;
  created_at: string;
}

function mapRow(row: DbRow): PhotoRow {
  const isLine = row.entity_type === 'RECEIVING_LINE';
  return {
    id: Number(row.id),
    receivingId: row.receiving_id_resolved != null ? Number(row.receiving_id_resolved) : null,
    receivingLineId: isLine ? Number(row.entity_id) : null,
    photoUrl: row.url,
    caption: row.caption || null,
    uploadedBy: row.uploaded_by != null ? Number(row.uploaded_by) : null,
    createdAt: row.created_at,
  };
}

// Resolve receiving_id whether the row is scoped to RECEIVING or RECEIVING_LINE.
// For RECEIVING rows it's entity_id itself; for RECEIVING_LINE rows we look it
// up through receiving_lines so callers can still pivot by PO/receiving package.
const SELECT_WITH_RID = `
  p.id, p.entity_type, p.entity_id,
  CASE
    WHEN p.entity_type = 'RECEIVING'      THEN p.entity_id
    WHEN p.entity_type = 'RECEIVING_LINE' THEN rl.receiving_id
    ELSE NULL
  END AS receiving_id_resolved,
  p.url, p.photo_type AS caption,
  p.taken_by_staff_id AS uploaded_by,
  p.created_at
`;

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const params = new URL(req.url).searchParams;
    const receivingId = Number(params.get('receivingId'));
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }

    const lineIdRaw = params.get('receivingLineId');
    const scope = params.get('scope');

    let where: string;
    const values: unknown[] = [];

    if (lineIdRaw != null) {
      const lineId = Number(lineIdRaw);
      if (!Number.isFinite(lineId) || lineId <= 0) {
        throw ApiError.badRequest('Valid receivingLineId is required');
      }
      where = `p.entity_type = 'RECEIVING_LINE' AND p.entity_id = $1`;
      values.push(lineId);
    } else if (scope === 'po') {
      where = `p.entity_type = 'RECEIVING' AND p.entity_id = $1`;
      values.push(receivingId);
    } else {
      // Combined: PO-level photos for this receiving package + item-level
      // photos for every receiving_lines row under it.
      where =
        `(p.entity_type = 'RECEIVING'      AND p.entity_id = $1) OR ` +
        `(p.entity_type = 'RECEIVING_LINE' AND rl.receiving_id = $1)`;
      values.push(receivingId);
    }

    const result = await pool.query<DbRow>(
      `SELECT ${SELECT_WITH_RID}
         FROM photos p
         LEFT JOIN receiving_lines rl
                ON p.entity_type = 'RECEIVING_LINE'
               AND rl.id = p.entity_id
        WHERE ${where}
        ORDER BY p.created_at ASC`,
      values,
    );

    return NextResponse.json({ photos: result.rows.map(mapRow) });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving-photos');
  }
}, { permission: 'receiving.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const receivingId = Number(body?.receivingId);
    const receivingLineIdRaw = body?.receivingLineId;
    const receivingLineId =
      receivingLineIdRaw != null && receivingLineIdRaw !== ''
        ? Number(receivingLineIdRaw)
        : null;
    const photoBase64: string | undefined = body?.photoBase64;
    const photoUrl: string | undefined = body?.photoUrl;
    const caption = String(body?.caption || '').trim() || null;
    // Server-trusted actor — body.uploadedBy is ignored.
    const uploadedBy = ctx.staffId;

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (receivingLineId != null && (!Number.isFinite(receivingLineId) || receivingLineId <= 0)) {
      throw ApiError.badRequest('Valid receivingLineId is required when provided');
    }
    if (!photoBase64 && !photoUrl) {
      throw ApiError.badRequest('Either photoBase64 or photoUrl is required');
    }

    const entityType = receivingLineId != null ? 'RECEIVING_LINE' : 'RECEIVING';
    const entityId = receivingLineId ?? receivingId;

    let finalUrl = photoUrl || '';
    if (photoBase64) {
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const scopeFolder = receivingLineId != null
        ? `line_${receivingLineId}`
        : `po_${receivingId}`;
      const filename = `receiving_photos/${scopeFolder}/photo_${Date.now()}.jpg`;
      const blob = await put(filename, buffer, { access: 'public', contentType: 'image/jpeg' });
      finalUrl = blob.url;
    }

    const photoType = caption || (receivingLineId != null ? 'receiving_item' : 'receiving');

    const inserted = await pool.query(
      `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (entity_type, entity_id, url) DO NOTHING
       RETURNING id`,
      [entityType, entityId, finalUrl, uploadedBy, photoType],
    );

    if (inserted.rowCount === 0) throw ApiError.conflict('Photo already exists');

    // Re-read with the receiving_id resolver so the response matches GET shape.
    const read = await pool.query<DbRow>(
      `SELECT ${SELECT_WITH_RID}
         FROM photos p
         LEFT JOIN receiving_lines rl
                ON p.entity_type = 'RECEIVING_LINE'
               AND rl.id = p.entity_id
        WHERE p.id = $1`,
      [inserted.rows[0].id],
    );

    return NextResponse.json({ success: true, photo: mapRow(read.rows[0]) });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-photos');
  }
}, { permission: 'receiving.upload_photo' });

export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      throw ApiError.badRequest('Valid id is required');
    }

    const existing = await pool.query(
      `SELECT url FROM photos
        WHERE id = $1
          AND entity_type IN ('RECEIVING', 'RECEIVING_LINE')`,
      [id],
    );
    if (existing.rowCount === 0) throw ApiError.notFound('photo', id);

    const photoUrl: string = existing.rows[0].url;
    await pool.query(`DELETE FROM photos WHERE id = $1`, [id]);

    if (photoUrl.includes('blob.vercel-storage.com') || photoUrl.includes('vercel-storage')) {
      try { await del(photoUrl); } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/receiving-photos');
  }
}, { permission: 'receiving.upload_photo' });
