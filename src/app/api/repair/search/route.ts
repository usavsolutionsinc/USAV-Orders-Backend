import { NextRequest, NextResponse } from 'next/server';
import { searchRepairs } from '@/lib/neon/repair-service-queries';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');

        if (!query || query.trim() === '') {
            return NextResponse.json({ results: [] });
        }

        const result = await searchRepairs(query.trim());

        return NextResponse.json({
            results: result,
            count: result.length
        });

    } catch (error: any) {
        console.error('Error searching repairs:', error);
        return NextResponse.json({ 
            error: 'Failed to search repairs',
            details: error.message 
        }, { status: 500 });
    }
}
