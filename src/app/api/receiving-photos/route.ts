import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import pool from '@/lib/db';
import { ApiError, errorResponse } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PhotoRow {
  id: number;
  receivingId: number;
  photoUrl: string;
  caption: string | null;
  uploadedBy: number | null;
  createdAt: string;
}

function mapRow(row: any): PhotoRow {
  return {
    id: Number(row.id),
    receivingId: Number(row.receiving_id),
    photoUrl: row.photo_url,
    caption: row.caption || null,
    uploadedBy: row.uploaded_by ? Number(row.uploaded_by) : null,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `id, entity_id AS receiving_id, url AS photo_url,
  photo_type AS caption, taken_by_staff_id AS uploaded_by, created_at`;

export async function GET(req: NextRequest) {
  try {
    const receivingId = Number(new URL(req.url).searchParams.get('receivingId'));
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }

    const result = await pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM photos
       WHERE entity_type = 'RECEIVING' AND entity_id = $1
       ORDER BY created_at ASC`,
      [receivingId],
    );

    return NextResponse.json({ photos: result.rows.map(mapRow) });
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving-photos');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const receivingId = Number(body?.receivingId);
    const photoBase64: string | undefined = body?.photoBase64;
    const photoUrl: string | undefined = body?.photoUrl;
    const caption = String(body?.caption || '').trim() || null;
    const uploadedBy = body?.uploadedBy ? Number(body.uploadedBy) : null;

    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      throw ApiError.badRequest('Valid receivingId is required');
    }
    if (!photoBase64 && !photoUrl) {
      throw ApiError.badRequest('Either photoBase64 or photoUrl is required');
    }

    let finalUrl = photoUrl || '';
    if (photoBase64) {
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `receiving_photos/${receivingId}/photo_${Date.now()}.jpg`;
      const blob = await put(filename, buffer, { access: 'public', contentType: 'image/jpeg' });
      finalUrl = blob.url;
    }

    const result = await pool.query(
      `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
       VALUES ('RECEIVING', $1, $2, $3, $4)
       ON CONFLICT (entity_type, entity_id, url) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [receivingId, finalUrl, uploadedBy, caption || 'receiving'],
    );

    if (result.rowCount === 0) throw ApiError.conflict('Photo already exists');

    return NextResponse.json({ success: true, photo: mapRow(result.rows[0]) });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-photos');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      throw ApiError.badRequest('Valid id is required');
    }

    const existing = await pool.query(
      `SELECT url FROM photos WHERE id = $1 AND entity_type = 'RECEIVING'`,
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
}
