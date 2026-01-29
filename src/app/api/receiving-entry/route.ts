import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';
import { receiving } from '@/lib/drizzle/schema';
import { getCarrier } from '@/utils/tracking';

// POST - Add entry to receiving table
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier: providedCarrier, timestamp } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        // Auto-detect carrier if not provided or set to Unknown
        const detectedCarrier = providedCarrier && providedCarrier !== 'Unknown' 
            ? providedCarrier 
            : getCarrier(trackingNumber);

        const now = timestamp || `${new Date().getMonth() + 1}/${new Date().getDate()}/${new Date().getFullYear()} ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}:${String(new Date().getSeconds()).padStart(2, '0')}`;
        
        // Insert into receiving table using explicit column names
        await db.insert(receiving).values({
            dateTime: now,
            receivingTrackingNumber: trackingNumber,
            carrier: detectedCarrier,
            // quantity is only touched by sheet import
        });

        return NextResponse.json({
            success: true,
            message: 'Entry added to receiving table',
            carrier: detectedCarrier,
            timestamp: now
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
        const results = await db.select({
            id: receiving.id,
            timestamp: receiving.dateTime,
            tracking: receiving.receivingTrackingNumber,
            carrier: receiving.carrier,
            quantity: receiving.quantity
        })
        .from(receiving)
        .orderBy(sql`${receiving.id} DESC`)
        .limit(100);
            
        return NextResponse.json(results);
    } catch (error) {
        console.error('Error fetching receiving entries:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving entries',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
