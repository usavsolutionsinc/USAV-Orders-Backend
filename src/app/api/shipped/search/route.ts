import { NextRequest, NextResponse } from 'next/server';
import { searchShippedOrders } from '@/lib/neon/orders-queries';
import { logRouteMetric } from '@/lib/route-metrics';
import { normalizeShippedSearchField } from '@/lib/shipped-search';

export async function GET(req: NextRequest) {
    const startedAt = Date.now();
    let ok = false;
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');
        const searchField = normalizeShippedSearchField(searchParams.get('searchField'));

        if (!query) {
            return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
        }

        const results = await searchShippedOrders(query, { searchField });
        ok = true;

        return NextResponse.json({
            results,
            count: results.length,
            query: query,
            searchField,
        });
    } catch (error: any) {
        console.error('Error searching shipped table:', error);
        return NextResponse.json({ 
            error: 'Failed to search', 
            details: error.message 
        }, { status: 500 });
    } finally {
        logRouteMetric({
            route: '/api/shipped/search',
            method: 'GET',
            startedAt,
            ok,
        });
    }
}

// POST endpoint to save search history
export async function POST(req: NextRequest) {
    const startedAt = Date.now();
    let ok = false;
    try {
        const body = await req.json();
        const { query, resultCount } = body;

        // Store in a simple search_history table (you may need to create this)
        // For now, we'll just return success
        ok = true;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error saving search history:', error);
        return NextResponse.json({ 
            error: 'Failed to save search history', 
            details: error.message 
        }, { status: 500 });
    } finally {
        logRouteMetric({
            route: '/api/shipped/search',
            method: 'POST',
            startedAt,
            ok,
        });
    }
}
