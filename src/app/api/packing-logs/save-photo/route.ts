import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

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
        const folderPath = join(process.cwd(), 'public', 'packer-photos', `Packer_${packerId}`);
        const filepath = join(folderPath, filename);

        // Ensure directory exists
        await mkdir(folderPath, { recursive: true });

        // Save file
        await writeFile(filepath, buffer);

        // Return the public URL path
        const publicPath = `/packer-photos/Packer_${packerId}/${filename}`;
        
        return NextResponse.json({ 
            success: true, 
            path: publicPath,
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
