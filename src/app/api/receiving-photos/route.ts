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

        const tableCheck = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables WHERE table_name = 'receiving_photos'
            ) AS exists`
        );
        if (!tableCheck.rows[0]?.exists) {
            return NextResponse.json({ photos: [] });
        }

        const result = await pool.query(
            `SELECT id, receiving_id, photo_url, caption, uploaded_by, created_at
             FROM receiving_photos
             WHERE receiving_id = $1
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

        const tableCheck = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables WHERE table_name = 'receiving_photos'
            ) AS exists`
        );

        if (!tableCheck.rows[0]?.exists) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS receiving_photos (
                    id SERIAL PRIMARY KEY,
                    receiving_id INTEGER NOT NULL,
                    photo_url TEXT NOT NULL,
                    caption TEXT,
                    uploaded_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await pool.query(
                `CREATE INDEX IF NOT EXISTS idx_receiving_photos_receiving_id ON receiving_photos(receiving_id)`
            );
        }

        const result = await pool.query(
            `INSERT INTO receiving_photos (receiving_id, photo_url, caption, uploaded_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, receiving_id, photo_url, caption, uploaded_by, created_at`,
            [receivingId, finalUrl, caption, uploadedBy || null]
        );

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
            `SELECT photo_url FROM receiving_photos WHERE id = $1`,
            [id]
        );

        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
        }

        const photoUrl: string = existing.rows[0].photo_url;

        await pool.query(`DELETE FROM receiving_photos WHERE id = $1`, [id]);

        // Remove from Vercel Blob if it's a blob URL
        if (photoUrl.includes('blob.vercel-storage.com') || photoUrl.includes('vercel-storage')) {
            try {
                await del(photoUrl);
            } catch {
                // non-fatal — blob deletion failure should not fail the request
            }
        }

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error deleting receiving photo:', error);
        return NextResponse.json({ error: 'Failed to delete photo', details: error.message }, { status: 500 });
    }
}
