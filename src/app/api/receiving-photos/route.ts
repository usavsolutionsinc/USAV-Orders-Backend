import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const receivingId = Number(searchParams.get('receivingId'));

        if (!Number.isFinite(receivingId) || receivingId <= 0) {
            return NextResponse.json({ error: 'Valid receivingId is required' }, { status: 400 });
        }

        const result = await pool.query(
            `SELECT id, entity_id AS receiving_id, url AS photo_url, photo_type AS caption,
                    taken_by_staff_id AS uploaded_by, created_at
             FROM photos
             WHERE entity_type = 'RECEIVING' AND entity_id = $1
             ORDER BY created_at ASC`,
            [receivingId]
        );

        return NextResponse.json({
            photos: result.rows.map((row: any) => ({
                id: Number(row.id),
                receivingId: Number(row.receiving_id),
                photoUrl: row.photo_url,
                caption: row.caption || null,
                uploadedBy: row.uploaded_by ? Number(row.uploaded_by) : null,
                createdAt: row.created_at,
            })),
        });
    } catch (error: any) {
        console.error('Error fetching receiving photos:', error);
        return NextResponse.json({ error: 'Failed to fetch photos', details: error.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const receivingId = Number(body?.receivingId);
        const photoBase64: string | undefined = body?.photoBase64;
        const photoUrl: string | undefined = body?.photoUrl;
        const caption = String(body?.caption || '').trim() || null;
        const uploadedBy = body?.uploadedBy ? Number(body.uploadedBy) : null;

        if (!Number.isFinite(receivingId) || receivingId <= 0) {
            return NextResponse.json({ error: 'Valid receivingId is required' }, { status: 400 });
        }
        if (!photoBase64 && !photoUrl) {
            return NextResponse.json({ error: 'Either photoBase64 or photoUrl is required' }, { status: 400 });
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
             RETURNING id, entity_id AS receiving_id, url AS photo_url,
                       photo_type AS caption, taken_by_staff_id AS uploaded_by, created_at`,
            [receivingId, finalUrl, uploadedBy || null, caption || 'receiving']
        );

        if (result.rowCount === 0) {
            return NextResponse.json({ error: 'Photo already exists' }, { status: 409 });
        }

        const row = result.rows[0];
        return NextResponse.json({
            success: true,
            photo: {
                id: Number(row.id),
                receivingId: Number(row.receiving_id),
                photoUrl: row.photo_url,
                caption: row.caption || null,
                uploadedBy: row.uploaded_by ? Number(row.uploaded_by) : null,
                createdAt: row.created_at,
            },
        });
    } catch (error: any) {
        console.error('Error saving receiving photo:', error);
        return NextResponse.json({ error: 'Failed to save photo', details: error.message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = Number(searchParams.get('id'));

        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
        }

        const existing = await pool.query(
            `SELECT url FROM photos WHERE id = $1 AND entity_type = 'RECEIVING'`,
            [id]
        );

        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
        }

        const photoUrl: string = existing.rows[0].url;
        await pool.query(`DELETE FROM photos WHERE id = $1`, [id]);

        if (photoUrl.includes('blob.vercel-storage.com') || photoUrl.includes('vercel-storage')) {
            try { await del(photoUrl); } catch { /* non-fatal */ }
        }

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error deleting receiving photo:', error);
        return NextResponse.json({ error: 'Failed to delete photo', details: error.message }, { status: 500 });
    }
}
