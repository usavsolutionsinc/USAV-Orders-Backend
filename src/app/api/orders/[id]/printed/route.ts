import { NextResponse } from 'next/server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    console.log(`Order ${id} marked as printed.`);
    return NextResponse.json({ success: true, id });
}
