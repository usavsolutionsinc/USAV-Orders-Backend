import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { uploadPhoto, isAdapterUploadEnabled, attachPhotoWithLegacyUrl } from '@/lib/photos/service';

export const POST = withAuth(async (req: NextRequest, ctx) => {
    try {
        const body = await req.json();
        const { photo, orderId, photoIndex, packerLogId, photoType } = body;
        const packerId = ctx.staffId;

        if (!photo || !orderId || photoIndex === undefined) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = `${orderId}_${photoIndex + 1}.jpg`;

        if (packerLogId && isAdapterUploadEnabled()) {
            const result = await uploadPhoto({
                organizationId: ctx.organizationId,
                staffId: Number(packerId),
                entityType: 'PACKER_LOG',
                entityId: Number(packerLogId),
                photoType: photoType ?? 'packer_photo',
                fileBuffer: buffer,
                contentType: 'image/jpeg',
                poRef: String(orderId),
            });
            return NextResponse.json({
                success: true,
                path: result.url,
                filename,
                photoId: result.id,
            });
        }

        const { put } = await import('@vercel/blob');
        const pathname = `packer_photos/packer_${packerId}/${filename}`;
        const blob = await put(pathname, buffer, {
            access: 'public',
            contentType: 'image/jpeg',
        });

        let photoId: number | null = null;
        if (packerLogId) {
            const attached = await attachPhotoWithLegacyUrl({
                organizationId: ctx.organizationId,
                staffId: Number(packerId),
                entityType: 'PACKER_LOG',
                entityId: Number(packerLogId),
                legacyUrl: blob.url,
                photoType: photoType ?? 'packer_photo',
            });
            photoId = attached.id;
        }

        return NextResponse.json({
            success: true,
            path: blob.url,
            filename,
            photoId,
        });
    } catch (error: unknown) {
        console.error('Error saving photo:', error);
        return NextResponse.json({
            error: 'Failed to save photo',
            details: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });
