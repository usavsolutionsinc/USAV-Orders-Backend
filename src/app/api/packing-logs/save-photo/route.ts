import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { photo, orderId, packerId, photoIndex } = body;

        if (!photo || !orderId || !packerId || photoIndex === undefined) {
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

        // Return the full URL from Vercel Blob
        return NextResponse.json({ 
            success: true, 
            path: blob.url,
            filename 
        });
    } catch (error: any) {
        console.error('Error saving photo:', error);
        return NextResponse.json({ 
            error: 'Failed to save photo', 
            details: error.message 
        }, { status: 500 });
    }
}
