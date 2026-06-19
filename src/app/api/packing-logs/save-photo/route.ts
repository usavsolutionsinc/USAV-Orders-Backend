import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { uploadPhoto } from '@/lib/photos/service';
import { photoContentUrl } from '@/lib/photos/display-url';

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

        if (!packerLogId) {
            return NextResponse.json({ error: 'packerLogId is required' }, { status: 400 });
        }

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
            path: photoContentUrl(result.id),
            filename,
            photoId: result.id,
        });
    } catch (error: unknown) {
        console.error('Error saving photo:', error);
        return NextResponse.json({
            error: 'Failed to save photo',
            details: error instanceof Error ? error.message : String(error),
        }, { status: 500 });
    }
}, { permission: 'packing.complete_order' });
