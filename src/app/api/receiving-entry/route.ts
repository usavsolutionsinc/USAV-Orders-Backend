import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { receiving } from '@/lib/drizzle/schema';
import { desc } from 'drizzle-orm';

// POST - Add entry to receiving table (for Google Sheets sync)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier, date, notes } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        // Insert into receiving table (col_2 = tracking number)
        const [result] = await db.insert(receiving).values({
            col2: trackingNumber,
            col3: carrier || null,
            col4: date || new Date().toISOString(),
            col5: notes || null
        }).returning();

        return NextResponse.json({
            success: true,
            entry: result,
            message: 'Entry added to receiving table'
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding receiving entry:', error);
        return NextResponse.json({ 
            error: 'Failed to add receiving entry',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET - Fetch all receiving entries
export async function GET() {
    try {
        const results = await db
            .select()
            .from(receiving)
            .orderBy(desc(receiving.col1));
            
        return NextResponse.json(results);
    } catch (error) {
        console.error('Error fetching receiving entries:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving entries',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
