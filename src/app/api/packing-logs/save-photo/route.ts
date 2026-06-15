import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const POST = withAuth(async (req: NextRequest, ctx) => {
    try {
        const body = await req.json();
        const { photo, orderId, photoIndex, packerLogId, photoType } = body;
        // Server-trusted actor.
        const packerId = ctx.staffId;

        if (!photo || !orderId || photoIndex === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Remove base64 prefix if present
        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Create filename: OrderID_1.jpg, OrderID_2.jpg, etc.
        const filename = `${orderId}_${photoIndex + 1}.jpg`;
        // Save to packer_photos/packer_1 or packer_photos/packer_2
        const pathname = `packer_photos/packer_${packerId}/${filename}`;

        // Upload to Vercel Blob Storage
        const blob = await put(pathname, buffer, {
            access: 'public',
            contentType: 'image/jpeg',
        });

        // Write to Neon DB photos table
        let photoId: number | null = null;
        if (packerLogId) {
            photoId = await withTenantTransaction(ctx.organizationId, async (client) => {
                const { rows } = await client.query<{ id: number }>(
                    `INSERT INTO photos
                         (entity_type, entity_id, url, taken_by_staff_id, photo_type, organization_id)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    [
                        'PACKER_LOG',
                        Number(packerLogId),
                        blob.url,
                        Number(packerId),
                        photoType ?? 'packer_photo',
                        ctx.organizationId,
                    ],
                );
                return rows[0]?.id ?? null;
            });
        }

        return NextResponse.json({
            success: true,
            path: blob.url,
            filename,
            photoId,
        });
    } catch (error: any) {
        console.error('Error saving photo:', error);
        return NextResponse.json({
            error: 'Failed to save photo',
            details: error.message
        }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });
